<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** Stores values that belong to one browser session. */
interface SessionStore
{
    /** Returns the value stored under a key, or null. */
    public function get(string $key): mixed;

    /** Stores a value under a key. */
    public function set(string $key, mixed $value): void;

    /** Removes the value stored under a key. */
    public function remove(string $key): void;

    /** Moves the values to a new session identifier and deletes the old session (HY-72). */
    public function renew(): void;
}
