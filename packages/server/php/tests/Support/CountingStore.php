<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\SessionStore;

/** Counts every call of the session store interface and keeps the values in memory (HY-120). */
final class CountingStore implements SessionStore
{
    /** The number of calls of the store interface. */
    public int $calls = 0;

    private readonly ArraySession $values;

    public function __construct()
    {
        $this->values = new ArraySession();
    }

    public function get(string $key): mixed
    {
        $this->calls++;

        return $this->values->get($key);
    }

    public function set(string $key, mixed $value): void
    {
        $this->calls++;
        $this->values->set($key, $value);
    }

    public function remove(string $key): void
    {
        $this->calls++;
        $this->values->remove($key);
    }

    public function renew(): void
    {
        $this->calls++;
        $this->values->renew();
    }
}
