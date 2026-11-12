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

    /**
     * Prepares the PHP session; it starts on the first read or write, so a request that never uses it creates no
     * session (HY-45) and `setup` runs just before it starts (HY-115). `$request` gives the cookies of the request,
     * parsed once (HY-129).
     */
    public function __construct(
        private readonly bool $https,
        private readonly Request $request,
        private readonly ?\Closure $setup = null,
    ) {
        ArgumentCount::most(\func_num_args(), 3);
    }

    private function start(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }
        $https = $this->secure();
        $name = self::name($https);
        $this->clientId = $this->request->cookie($name);
        // An identifier that is not of HY-45 starts no session, the same as no identifier.
        $id = $this->clientId;
        if ($id !== null && preg_match('/^[A-Za-z0-9,-]{22,128}$/D', $id) !== 1) {
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
        if (!session_start(self::options($https))) {
            throw new \RuntimeException('hyper: the session could not start');
        }
        $this->sendCookie();
    }

    /**
     * Sends the session cookie of HY-45 when the session identifier differs from the one that the client holds, with
     * the attributes of `options()`. A session whose identifier the server kept sends nothing.
     */
    private function sendCookie(): void
    {
        $id = session_id();
        if (!is_string($id)) {
            throw new \RuntimeException('hyper: the session has no identifier');
        }
        if ($id === $this->clientId) {
            return;
        }
        $https = $this->secure();
        $options = self::options($https);
        $sent = setcookie(self::name($https), $id, [
            'path' => $options['cookie_path'],
            'domain' => $options['cookie_domain'],
            'secure' => $options['cookie_secure'],
            'httponly' => $options['cookie_httponly'],
            'samesite' => $options['cookie_samesite'],
        ]);
        if (!$sent) {
            throw new \RuntimeException('hyper: the session cookie could not be sent');
        }
        $this->clientId = $id;
    }

    /** Whether the session runs over HTTPS: the request is HTTPS, or the application declares that it is served over HTTPS (HY-45). */
    private function secure(): bool
    {
        return $this->https || $this->request->https;
    }

    /**
     * Returns the session cookie name: `__Host-hy-session` over HTTPS and `hy-session` otherwise (HY-45).
     *
     * @internal
     */
    public static function name(bool $https): string
    {
        return $https ? '__Host-hy-session' : 'hy-session';
    }

    /**
     * Returns the session options: the cookie name of HY-45 with `Path=/` and no `Domain`, HttpOnly, SameSite=Lax,
     * Secure on HTTPS, only identifiers that the server created, no cookie from PHP (`use_cookies`, HY-129), no caching
     * headers, because the application sets Cache-Control (HY-52), and the record form that the other servers read
     * (HY-104).
     *
     * @return array{name: string, cookie_path: '/', cookie_domain: '', cookie_httponly: true, cookie_samesite: 'Lax',
     *     cookie_secure: bool, use_strict_mode: true, use_only_cookies: true, use_cookies: false, cache_limiter: '',
     *     serialize_handler: 'php_serialize'}
     *
     * @internal
     */
    public static function options(bool $https): array
    {
        return [
            'name' => self::name($https),
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
        ];
    }

    public function get(string $key): mixed
    {
        ArgumentCount::most(\func_num_args(), 1);
        $this->start();

        return $_SESSION[$key] ?? null;
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

    public function renew(): void
    {
        ArgumentCount::most(\func_num_args(), 0);
        $this->start();
        session_regenerate_id(true);
        $this->sendCookie();
    }
}
