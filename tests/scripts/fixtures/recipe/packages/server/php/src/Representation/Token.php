<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The token of a JSON text of HY-2.
 *
 * @internal
 */
class Token
{
    public function __construct()
    {
        $this->seed();
    }

    public function text(): string
    {
        return $this->shape();
    }

    public function shape(): string
    {
        return 'x';
    }

    private function seed(): void
    {
    }
}
