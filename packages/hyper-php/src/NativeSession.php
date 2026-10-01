<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** Stores session values in the PHP session. */
final class NativeSession implements SessionStore
{
    /** Starts the PHP session when it is not active, with the cookie options of HY-45. */
    public function __construct(bool $https)
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }
        $name = session_name();
        $id = $_COOKIE[$name] ?? null;
        if ($id !== null && (!is_string($id) || preg_match('/^[A-Za-z0-9,-]{22,256}$/D', $id) !== 1)) {
            unset($_COOKIE[$name]);
        }
        session_start(self::options($https || (($_SERVER['HTTPS'] ?? '') !== '' && ($_SERVER['HTTPS'] ?? '') !== 'off')));
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
        return $_SESSION[$key] ?? null;
    }

    public function set(string $key, mixed $value): void
    {
        $_SESSION[$key] = $value;
    }

    public function remove(string $key): void
    {
        unset($_SESSION[$key]);
    }
}
