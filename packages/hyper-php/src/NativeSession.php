<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** Stores session values in the PHP session. */
final class NativeSession implements SessionStore
{
    /** Starts the PHP session when it is not active. */
    public function __construct()
    {
        if (session_status() !== PHP_SESSION_ACTIVE) {
            session_start();
        }
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
