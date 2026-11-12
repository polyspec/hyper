<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server\Tests\Support;

/** A session handler whose session cannot start: its open fails, or its read gives no data (HY-45). */
final class RefusingSessionHandler implements \SessionHandlerInterface
{
    public function __construct(private readonly bool $opens)
    {
    }

    public function open(string $path, string $name): bool
    {
        return $this->opens;
    }

    public function close(): bool
    {
        return true;
    }

    public function read(string $id): string|false
    {
        return false;
    }

    public function write(string $id, string $data): bool
    {
        return true;
    }

    public function destroy(string $id): bool
    {
        return true;
    }

    public function gc(int $max_lifetime): int
    {
        return 0;
    }
}
