<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** Stores session values in the PHP session. */
final class NativeSession implements SessionStore
{
    /** Prepares the PHP session; it starts on the first read or write, so a request that never uses it creates no session (HY-45). */
    public function __construct(private readonly bool $https)
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
        if ($id !== null && (!is_string($id) || preg_match('/^[A-Za-z0-9,-]{22,256}$/D', $id) !== 1)) {
            unset($_COOKIE[$name]);
        }
        session_start(self::options($https));
    }

    /** Returns the session cookie name: `__Host-hy-session` over HTTPS and `hy-session` otherwise (HY-45). */
    public static function name(bool $https): string
    {
        return $https ? '__Host-hy-session' : 'hy-session';
    }

    /**
     * Returns the session options: the cookie name of HY-45 with `Path=/` and no `Domain`, HttpOnly, SameSite=Lax,
     * Secure on HTTPS, only identifiers that the server created, and no caching headers, because the application
     * sets Cache-Control (HY-52).
     *
     * @return array{name: string, cookie_path: '/', cookie_domain: '', cookie_httponly: true, cookie_samesite: 'Lax', cookie_secure: bool, use_strict_mode: true, use_only_cookies: true, cache_limiter: ''}
     */
    public static function options(bool $https): array
    {
        return ['name' => self::name($https), 'cookie_path' => '/', 'cookie_domain' => '', 'cookie_httponly' => true, 'cookie_samesite' => 'Lax', 'cookie_secure' => $https, 'use_strict_mode' => true, 'use_only_cookies' => true, 'cache_limiter' => ''];
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
