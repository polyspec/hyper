<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** Stores session values in the PHP session. */
final class NativeSession implements SessionStore
{
    /** Prepares the PHP session; it starts on the first read or write, so a request that never uses it creates no session (HY-45) and `setup` runs just before it starts (HY-115). */
    public function __construct(private readonly bool $https, private readonly ?\Closure $setup = null)
    {
    }

    private function start(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }
        $https = $this->https || (($_SERVER['HTTPS'] ?? '') !== '' && ($_SERVER['HTTPS'] ?? '') !== 'off');
        $name = self::name($https);
        $id = $_COOKIE[$name] ?? null;
        if ($id !== null && (!is_string($id) || preg_match('/^[A-Za-z0-9,-]{22,128}$/D', $id) !== 1)) {
            unset($_COOKIE[$name]);
        }
        if ($this->setup !== null) {
            ($this->setup)();
        }
        // A session that cannot start, such as one whose lock another request holds, fails the request whatever
        // error_reporting() keeps: the request would otherwise answer with an empty session and lose what it
        // stores (HY-115).
        $started = false;
        try {
            $started = session_start(self::options($https));
        } finally {
            if (!$started) {
                self::withdrawCookie($name);
            }
        }
        if (!$started) {
            throw new \RuntimeException('hyper: the session could not start');
        }
    }

    /**
     * Removes the session cookie that a failed start queued. With strict mode PHP takes an identifier that the handler
     * could not validate, also for a lost connection, as unknown: it queues the cookie of a new identifier before it
     * reads, and the client would lose its session with the failed request (HY-115).
     */
    private static function withdrawCookie(string $name): void
    {
        $others = array_filter(
            headers_list(),
            static fn (string $line): bool => stripos($line, 'Set-Cookie:') === 0
                && !str_starts_with($line, "Set-Cookie: {$name}="),
        );
        header_remove('Set-Cookie');
        foreach ($others as $line) {
            header($line, false);
        }
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
     * Secure on HTTPS, only identifiers that the server created, no caching headers, because the application sets
     * Cache-Control (HY-52), and the record form that the other servers read (HY-104).
     *
     * @return array{name: string, cookie_path: '/', cookie_domain: '', cookie_httponly: true, cookie_samesite: 'Lax',
     *     cookie_secure: bool, use_strict_mode: true, use_only_cookies: true, cache_limiter: '',
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
            'cache_limiter' => '',
            'serialize_handler' => 'php_serialize',
        ];
    }

    public function get(string $key): mixed
    {
        $this->start();

        return $_SESSION[$key] ?? null;
    }

    public function set(string $key, mixed $value): void
    {
        $this->start();
        $_SESSION[$key] = $value;
    }

    public function remove(string $key): void
    {
        $this->start();
        unset($_SESSION[$key]);
    }

    public function renew(): void
    {
        $this->start();
        session_regenerate_id(true);
    }
}
