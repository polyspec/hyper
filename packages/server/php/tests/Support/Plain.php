<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

/**
 * Converts the decoded JSON of a case to the values that loaders return: arrays for lists and non-empty objects,
 * and `stdClass` for empty objects, so that an empty map stays a map. `map` gives an observed map the same form.
 */
final class Plain
{
    public static function value(mixed $value): mixed
    {
        if ($value instanceof \stdClass) {
            $map = get_object_vars($value);

            return $map === [] ? new \stdClass() : array_map(self::value(...), $map);
        }

        return is_array($value) ? array_map(self::value(...), $value) : $value;
    }

    /**
     * @param array<array-key, mixed> $value an observed map: empty, it is an object, not a list
     * @return array<array-key, mixed>|\stdClass
     */
    public static function map(array $value): array|\stdClass
    {
        return $value === [] ? new \stdClass() : $value;
    }
}
