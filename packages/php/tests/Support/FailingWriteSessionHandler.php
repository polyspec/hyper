<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

/**
 * A session handler that opens and reads an empty session and whose write fails, as phpredis does for a request that
 * lost its lock (HY-115.23).
 */
final class FailingWriteSessionHandler implements \SessionHandlerInterface
{
    public function open(string $path, string $name): bool
    {
        return true;
    }

    public function close(): bool
    {
        return true;
    }

    public function read(string $id): string
    {
        return '';
    }

    public function write(string $id, string $data): bool
    {
        return false;
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
