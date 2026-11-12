<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server;

/**
 * The count of the arguments of a call of a public member (HY-106.8): PHP counts a missing argument and not an extra
 * one, which this class fails.
 *
 * @internal
 */
final class ArgumentCount
{
    /** Fails a call that gives more arguments than the parameters of its member, with the class that PHP raises. */
    public static function most(int $given, int $most): void
    {
        if ($given > $most) {
            throw new \ArgumentCountError("argument count {$given} is above {$most} (HY-106)");
        }
    }
}
