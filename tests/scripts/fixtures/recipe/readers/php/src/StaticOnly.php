<?php

namespace Fixture\Readers;

/**
 * A class of static methods, whose empty private constructor stops its construction.
 *
 * @internal
 */
final class StaticOnly
{
    private function __construct()
    {
    }

    public static function twice(int $n): int
    {
        return 2 * $n;
    }
}
