<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\SessionStore;

/** Records every call of the session store interface and keeps the values in memory (HY-120). */
final class CountingStore implements SessionStore
{
    /** @var list<string> the calls of the store interface, in order: `get <key>`, `set <key>`, `remove <key>` or `renew` */
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

    /** Returns the value of a key, or null, without recording a call. */
    public function peek(string $key): mixed
    {
        return $this->values->get($key);
    }

    /** Whether the store holds a key, without recording a call. */
    public function holds(string $key): bool
    {
        return $this->values->get($key) !== null;
    }

    public function get(string $key): mixed
    {
        $this->record("get {$key}");

        return $this->values->get($key);
    }

    public function set(string $key, mixed $value): void
    {
        $this->record("set {$key}");
        $this->values->set($key, $value);
    }

    public function remove(string $key): void
    {
        $this->record("remove {$key}");
        $this->values->remove($key);
    }

    public function renew(): void
    {
        $this->record('renew');
        $this->values->renew();
    }

    private function record(string $call): void
    {
        $this->log[] = $call;
    }
}
