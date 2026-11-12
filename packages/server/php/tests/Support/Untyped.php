<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server\Tests\Support;

/**
 * Gives a test a call or a class without the types of its parameters, for a case that hands a typed parameter a value
 * of another type and expects the refusal of the server or of PHP. The call stays a call of this code, so strict types
 * apply to it.
 */
final class Untyped
{
    /** Returns the call as a callable that states no parameter. */
    public static function call(callable $call): callable
    {
        return $call;
    }

    /**
     * Returns the name of the class as a string that states no class.
     *
     * @param class-string $class
     */
    public static function name(string $class): string
    {
        return $class;
    }
}
