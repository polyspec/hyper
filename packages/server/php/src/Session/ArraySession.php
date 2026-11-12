<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** Stores session values in memory for one process. */
final class ArraySession implements SessionStore
{
    /** @var array<string, mixed> */
    private array $values;

    private int $renewals;

    public function __construct()
    {
        ArgumentCount::most(\func_num_args(), 0);
        $this->values = [];
        $this->renewals = 0;
    }

    public function get(string $key): mixed
    {
        ArgumentCount::most(\func_num_args(), 1);
        return $this->values[$key] ?? null;
    }

    public function set(string $key, mixed $value): void
    {
        ArgumentCount::most(\func_num_args(), 2);
        $this->values[$key] = $value;
    }

    public function remove(string $key): void
    {
        ArgumentCount::most(\func_num_args(), 1);
        unset($this->values[$key]);
    }

    /** Counts the renewals; the values have no identifier in memory (HY-72). */
    public function renew(): void
    {
        ArgumentCount::most(\func_num_args(), 0);
        $this->renewals++;
    }

    /**
     * Returns how many times the session was renewed.
     *
     * @internal
     */
    public function renewals(): int
    {
        return $this->renewals;
    }
}
