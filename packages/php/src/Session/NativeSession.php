<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * Stores session values in the PHP session. The session runs with `use_cookies` off: it takes the identifier of the
 * request's session cookie (HY-45, HY-129) and this class sends the session cookie itself.
 */
final class NativeSession implements SessionStore
{
    /** The session identifier that the client holds, which is the request's cookie until the server sends another one. */
    private ?string $clientId = null;

    /** The identifier that the session holds after its start or its renewal; the host sends its cookie (HY-45.8). */
    private ?string $issuedId = null;

    /**
     * Prepares the PHP session; it starts on the first read or write, so a request that never uses it creates no
     * session (HY-45) and `setup` runs just before it starts (HY-115). `$request` gives the cookies of the request,
     * parsed once (HY-129). `$cookieName` is the name of the session cookie, which the host reads from the core
     * (HY-45.1, HY-104.45).
     */
    public function __construct(
        private readonly bool $https,
        private readonly Request $request,
        private readonly string $cookieName,
        private readonly ?\Closure $setup = null,
    ) {
        ArgumentCount::most(\func_num_args(), 4);
    }

    private function start(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }
        $https = $this->secure();
        $name = $this->cookieName;
        $this->clientId = $this->request->cookie($name);
        // An identifier that is not of HY-45 starts no session, the same as no identifier; PHP and the session-store
        // library accept 22 to 256 characters (HY-104.42).
        $id = $this->clientId;
        if ($id !== null && preg_match('/^[A-Za-z0-9,-]{22,256}$/D', $id) !== 1) {
            $id = null;
        }
        if ($this->setup !== null) {
            ($this->setup)();
        }
        if ($id !== null) {
            session_id($id);
        }
        // A session that cannot start, such as one whose lock another request holds, fails the request whatever
        // error_reporting() keeps: the request would otherwise answer with an empty session and lose what it
        // stores (HY-115). PHP queues no cookie with `use_cookies` off, so a failed start sends none.
        // HY-60.14: a failed open escapes the answer of the request, so it is not handled as an error of the
        // application.
        try {
            $started = session_start(self::options($https, $this->cookieName));
        } catch (\Throwable $error) {
            throw new SessionOpenError($error->getMessage(), 0, $error);
        }
        if (!$started) {
            throw new SessionOpenError('hyper: the session could not start');
        }
        $this->issuedId = $this->identifier();
    }

    /**
     * Returns the field value of the session cookie of HY-45 that the client must receive, or null when it already
     * holds the identifier of the session. The host writes this value into the response (HY-45.8, HY-104.40), and
     * PHP writes no cookie itself, because `setcookie` would write path and secure in lower case.
     *
     * @internal
     */
    public function cookieHeader(): ?string
    {
        if ($this->issuedId === null || $this->issuedId === $this->clientId) {
            return null;
        }

        return CoreRules::shared()->sessionCookieHeader($this->issuedId, $this->secure());
    }

    private function identifier(): string
    {
        $id = session_id();
        if (!is_string($id)) {
            throw new \RuntimeException('hyper: the session has no identifier');
        }

        return $id;
    }

    /** Whether the session runs over HTTPS: the request is HTTPS, or the application declares that it is served over HTTPS (HY-45). */
    private function secure(): bool
    {
        return $this->https || $this->request->https;
    }

    /**
     * Returns the session options: the cookie name `$name` of HY-45 with `Path=/` and no `Domain`, HttpOnly,
     * SameSite=Lax, Secure on HTTPS, only identifiers that the server created, no cookie from PHP (`use_cookies`,
     * HY-129), no caching headers, because the application sets Cache-Control (HY-52), and the record form that the
     * other servers read (HY-104), and no removal of expired sessions during a request (`gc_probability` 0, HY-104.33).
     *
     * @return array{name: string, cookie_path: '/', cookie_domain: '', cookie_httponly: true, cookie_samesite: 'Lax',
     *     cookie_secure: bool, use_strict_mode: true, use_only_cookies: true, use_cookies: false, cache_limiter: '',
     *     serialize_handler: 'php_serialize', gc_probability: 0}
     *
     * @internal
     */
    public static function options(bool $https, string $name): array
    {
        return [
            'name' => $name,
            'cookie_path' => '/',
            'cookie_domain' => '',
            'cookie_httponly' => true,
            'cookie_samesite' => 'Lax',
            'cookie_secure' => $https,
            'use_strict_mode' => true,
            'use_only_cookies' => true,
            'use_cookies' => false,
            'cache_limiter' => '',
            'serialize_handler' => 'php_serialize',
            'gc_probability' => 0,
        ];
    }

    /**
     * Removes the session files of `session.save_path` whose lifetime of `session.gc_maxlifetime` has passed, skips a
     * file whose lock a request holds, and returns how many it removed (HY-104.33, SF-5). An empty save path is the
     * temporary directory, as for the native files handler. No request calls it: the application calls it when it
     * chooses, such as from a scheduled task, because the options turn the removal during a request off. A directory
     * that cannot be read fails with `SessionStoreIoError` (SF-9.2). A `session.save_handler` other than `files` fails
     * with kind `invalid_session_handler` and names the handler, because its store removes ended sessions itself
     * (HY-104.44).
     *
     * The save path is read as the native files handler reads it (ext/session/mod_files.c of PHP 8.4): up to two
     * fields before the path, separated by `;`, are the depth of the subdirectories and the mode of the files. A depth
     * of 0 keeps the files in the path itself, so the path is collected. Another depth keeps them in subdirectories,
     * which the store does not walk, so the whole save path goes to the store, which fails with `invalid_directory`
     * and names it (SF-1.2).
     */
    public static function collect(): int
    {
        ArgumentCount::most(\func_num_args(), 0);
        // HY-104.44: another handler, such as redis or a handler of the application, keeps no files of this store.
        $handler = (string) ini_get('session.save_handler');
        if ($handler !== 'files') {
            throw new HyperValueError(
                "collect removes the files of the handler files, and session.save_handler is {$handler}, "
                . 'whose store removes ended sessions itself (HY-115.2)',
                'invalid_session_handler',
            );
        }
        $directory = (string) ini_get('session.save_path');
        if ($directory === '') {
            $directory = sys_get_temp_dir();
        }
        $fields = explode(';', $directory, 3);
        if (\count($fields) > 1 && (int) $fields[0] === 0) {
            $directory = $fields[\count($fields) - 1];
        }

        return \Polyspec\SessionStore\FileSessions::inDirectory($directory, (int) ini_get('session.gc_maxlifetime'))
            ->collect();
    }

    public function get(string $key): mixed
    {
        ArgumentCount::most(\func_num_args(), 1);
        $this->start();
        $value = $_SESSION[$key] ?? null;
        self::refuseClasses($value);

        return $value;
    }

    /**
     * Fails with kind `record` for an object of a class other than stdClass at any depth of a stored value, which the
     * Node and the Python server refuse through the session-store library (HY-104.41).
     */
    private static function refuseClasses(mixed $value): void
    {
        if (is_object($value)) {
            if (get_class($value) !== \stdClass::class) {
                throw new RecordError(
                    'hyper: the session record holds an object of class ' . get_class($value) . ' (HY-104.41)',
                    'record',
                );
            }
            $value = get_object_vars($value);
        }
        if (is_array($value)) {
            foreach ($value as $item) {
                self::refuseClasses($item);
            }
        }
    }

    public function set(string $key, mixed $value): void
    {
        ArgumentCount::most(\func_num_args(), 2);
        $this->start();
        $_SESSION[$key] = $value;
    }

    public function remove(string $key): void
    {
        ArgumentCount::most(\func_num_args(), 1);
        $this->start();
        unset($_SESSION[$key]);
    }

    /**
     * Writes and closes a started session before the server answers, so that a session that cannot be written, as
     * the session of a request that lost its lock, fails the request with the plain 500 (HY-115.23, HY-43). A request
     * that started no session writes nothing.
     *
     * @internal
     */
    public function close(): void
    {
        ArgumentCount::most(\func_num_args(), 0);
        if (session_status() !== PHP_SESSION_ACTIVE) {
            return;
        }
        // PHP 8.4 returns true from session_write_close() when the write fails and only warns: the function returns
        // true after php_session_flush(), whose save of the state returns nothing (ext/session/session.c:2837-2838
        // and :1767-1773 of php-8.4.27). So a warning raised during the call, read here and not raised, fails the
        // close as a return of false does; the handler covers that call alone, so no other warning counts.
        $warning = null;
        set_error_handler(static function (int $level, string $message) use (&$warning): bool {
            $warning = $message;

            return true;
        });
        try {
            $closed = session_write_close();
        } finally {
            restore_error_handler();
        }
        if (!$closed || $warning !== null) {
            throw new SessionCloseError(
                'hyper: the session could not be written' . ($warning === null ? '' : ": {$warning}"),
            );
        }
    }

    public function renew(): void
    {
        ArgumentCount::most(\func_num_args(), 0);
        $this->start();
        // PHP keeps the identifier when the headers are sent, so the client would keep an identifier that the renewal
        // was to replace; the cookie of a new identifier cannot be sent then (HY-129).
        if (headers_sent() || !session_regenerate_id(true)) {
            throw new \RuntimeException('hyper: the session cookie could not be sent');
        }
        $this->issuedId = $this->identifier();
    }
}
