<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** Stores session values in memory for one process. */
final class ArraySession implements SessionStore
{
    /** @var array<string, mixed> */
    private array $values = [];

    private int $renewals = 0;

    public function get(string $key): mixed
    {
        return $this->values[$key] ?? null;
    }

    public function set(string $key, mixed $value): void
    {
        $this->values[$key] = $value;
    }

    public function remove(string $key): void
    {
        unset($this->values[$key]);
    }

    /** Counts the renewals; the values have no identifier in memory (HY-72). */
    public function renew(): void
    {
        $this->renewals++;
    }

    /** Returns how many times the session was renewed. */
    public function renewals(): int
    {
        return $this->renewals;
    }
}
