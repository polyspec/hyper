<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** Kept values (HY-37, HY-38). The JavaScript implementation follows the same rules; both pass conformance/keep.json. */
final class Kept
{
    public const KINDS = ['server', 'cookie', 'localStorage', 'sessionStorage'];

    /**
     * Replaces values at kept paths when the path exists and the types match.
     *
     * @param array<string, mixed> $data
     * @param list<array{0: string, 1: mixed}> $kept
     * @return array<string, mixed>
     */
    public static function apply(array $data, array $kept): array
    {
        foreach ($kept as [$path, $value]) {
            $data = self::replace($data, explode('.', $path), $value);
        }

        return $data;
    }

    /** @param list<string> $keys */
    private static function replace(mixed $container, array $keys, mixed $value): mixed
    {
        if (!is_array($container)) {
            return $container;
        }
        $key = array_shift($keys);
        if (array_is_list($container) && $container !== []) {
            // A list accepts only an index.
            if (preg_match('/^\d+$/D', $key) !== 1) {
                return $container;
            }
            $index = (int) $key;
        } else {
            $index = $key;
        }
        if (!array_key_exists($index, $container)) {
            return $container;
        }
        if ($keys === []) {
            if (self::kind($container[$index]) === self::kind($value)) {
                $container[$index] = $value;
            }

            return $container;
        }
        $container[$index] = self::replace($container[$index], $keys, $value);

        return $container;
    }

    /** Returns the value type of the data model: null, bool, number, string, list or map. */
    private static function kind(mixed $value): string
    {
        return match (true) {
            $value === null => 'null',
            is_bool($value) => 'bool',
            is_int($value), is_float($value) => 'number',
            is_string($value) => 'string',
            $value instanceof \stdClass => 'map',
            is_array($value) => array_is_list($value) ? 'list' : 'map',
            default => 'other',
        };
    }
}
