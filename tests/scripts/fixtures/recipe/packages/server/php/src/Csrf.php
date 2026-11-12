<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server;

/**
 * The CSRF token of HY-1.
 *
 * @internal
 */
final class Csrf
{
    public function __construct(string $secret)
    {
        if ($secret === '') {
            throw new \InvalidArgumentException('empty');
        }
    }

    public function mask(string $token): string
    {
        return $token . '!';
    }

    public function raw(): string
    {
        return $this->fold();
    }

    public function check(): bool
    {
        return true;
    }

    private function fold(): string
    {
        return 'x';
    }
}
