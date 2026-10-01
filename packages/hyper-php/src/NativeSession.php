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
        $name = session_name();
        $id = $_COOKIE[$name] ?? null;
        if ($id !== null && (!is_string($id) || preg_match('/^[A-Za-z0-9,-]{22,256}$/D', $id) !== 1)) {
            unset($_COOKIE[$name]);
        }
        session_start(self::options($this->https || (($_SERVER['HTTPS'] ?? '') !== '' && ($_SERVER['HTTPS'] ?? '') !== 'off')));
    }

    /**
     * Returns the session options: an HttpOnly, SameSite=Lax cookie, Secure on HTTPS, and only
     * identifiers that the server created (HY-45).
     *
     * @return array{cookie_httponly: true, cookie_samesite: 'Lax', cookie_secure: bool, use_strict_mode: true, use_only_cookies: true}
     */
    public static function options(bool $https): array
    {
        return ['cookie_httponly' => true, 'cookie_samesite' => 'Lax', 'cookie_secure' => $https, 'use_strict_mode' => true, 'use_only_cookies' => true];
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
}
