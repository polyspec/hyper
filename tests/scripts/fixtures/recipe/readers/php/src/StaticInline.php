<?php

namespace Fixture\Readers;

/**
 * A class of static methods whose empty private constructor is declared on one line.
 *
 * @internal
 */
final class StaticInline
{
    private function __construct() {}

    public static function twice(int $n): int
    {
        return 2 * $n;
    }
}
