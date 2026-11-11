<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

/**
 * Converts the decoded JSON of a case to the arrays and lists that the server takes. An empty object becomes an empty
 * array, as `Json::file` gives it; `map` turns an empty observed map back into an object, which the case compares.
 */
final class Plain
{
    public static function value(mixed $value): mixed
    {
        if ($value instanceof \stdClass) {
            $value = (array) $value;
        }

        return is_array($value) ? array_map(self::value(...), $value) : $value;
    }

    /** @param array<array-key, mixed> $value an observed map: empty, it is an object, not a list */
    public static function map(array $value): array|\stdClass
    {
        return $value === [] ? new \stdClass() : $value;
    }
}
