<?php

namespace Fixture\Readers;

/**
 * A class of static methods whose empty private constructor holds only a comment.
 *
 * @internal
 */
final class StaticCommented
{
    private function __construct()
    {
        // No instance: the class holds only static methods.
    }

    public static function twice(int $n): int
    {
        return 2 * $n;
    }
}
