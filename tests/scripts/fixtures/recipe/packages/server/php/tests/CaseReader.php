<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server\Tests;

final class CaseReader
{
    public function cases(): array
    {
        return [];
    }

    public function section(): string
    {
        return '';
    }

    public function id(): string
    {
        return '';
    }

    public function has(): bool
    {
        return false;
    }

    public function input(): string
    {
        return '';
    }

    public function compare(): string
    {
        return '';
    }

    public function outcome(): string
    {
        return '';
    }

    public function fail(): string
    {
        return '';
    }

    public function line(): int
    {
        return 0;
    }

    private function declaration(): string
    {
        return '';
    }

    private function matches(): bool
    {
        return false;
    }

    private function equal(): bool
    {
        return false;
    }
}
