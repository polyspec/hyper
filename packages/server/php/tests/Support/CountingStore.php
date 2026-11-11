<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\SessionStore;

/** Counts and logs every call of the session store interface and keeps the values in memory (HY-120). */
final class CountingStore implements SessionStore
{
    /** The number of calls of the store interface. */
    public int $calls = 0;

    /** The names of the calls of the store interface, in order: get, set, remove or renew. */
    public array $log = [];

    private readonly ArraySession $values;

    public function __construct()
    {
        $this->values = new ArraySession();
    }

    /** Presets a value without recording a call, as the host gives the request its session. */
    public function preset(string $key, mixed $value): void
    {
        $this->values->set($key, $value);
    }

    /** Whether the store holds a key, without recording a call. */
    public function holds(string $key): bool
    {
        return $this->values->get($key) !== null;
    }

    public function get(string $key): mixed
    {
        $this->record('get');

        return $this->values->get($key);
    }

    public function set(string $key, mixed $value): void
    {
        $this->record('set');
        $this->values->set($key, $value);
    }

    public function remove(string $key): void
    {
        $this->record('remove');
        $this->values->remove($key);
    }

    public function renew(): void
    {
        $this->record('renew');
        $this->values->renew();
    }

    private function record(string $call): void
    {
        $this->calls++;
        $this->log[] = $call;
    }
}
