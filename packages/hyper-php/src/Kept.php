<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

use Polyspec\Template\Value\Bind;

/** Kept values (HY-37, HY-38). Values outside the template data model are ignored. The JavaScript implementation follows the same rules; both pass conformance/keep.json. */
final class Kept
{
    public const KINDS = ['server', 'cookie', 'localStorage', 'sessionStorage'];

    /**
     * Replaces values at kept paths when the path exists and the kept value conforms to its value.
     *
     * @param array<string, mixed> $data
     * @param list<array{0: string, 1: mixed}> $kept
     * @return array<string, mixed>
     */
    public static function apply(array $data, array $kept): array
    {
        foreach ($kept as [$path, $value]) {
            if (self::inDataModel($value)) {
                $applied = false;
                $data = self::replace($data, explode('.', $path), $value, $applied);
            }
        }

        return $data;
    }

    /**
     * Returns the kept values that conform to the data, by path (HY-17, HY-38).
     *
     * @param array<string, mixed> $data
     * @param list<array{0: string, 1: mixed}> $kept
     * @return array<string, mixed>
     */
    public static function select(array $data, array $kept): array
    {
        $selected = [];
        foreach ($kept as [$path, $value]) {
            $applied = false;
            if (self::inDataModel($value)) {
                $data = self::replace($data, explode('.', $path), $value, $applied);
            }
            if ($applied) {
                $selected[$path] = $value;
            }
        }

        return $selected;
    }

    /** @param list<string> $keys */
    private static function replace(mixed $container, array $keys, mixed $value, bool &$applied): mixed
    {
        if ($container instanceof \stdClass) {
            $key = $keys[0];
            if (!property_exists($container, $key)) {
                return $container;
            }
            $copy = clone $container;
            $rest = array_slice($keys, 1);
            if ($rest === []) {
                if (self::conforms($value, $copy->{$key})) {
                    $copy->{$key} = $value;
                    $applied = true;
                }
            } else {
                $copy->{$key} = self::replace($copy->{$key}, $rest, $value, $applied);
            }

            return $copy;
        }
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
            if (self::conforms($value, $container[$index])) {
                $container[$index] = $value;
                $applied = true;
            }

            return $container;
        }
        $container[$index] = self::replace($container[$index], $keys, $value, $applied);

        return $container;
    }

    /** Returns true for a value of the template data model; for example, integers outside ±(2^53 − 1) are not. */
    public static function inDataModel(mixed $value): bool
    {
        try {
            Bind::value($value);

            return true;
        } catch (\Throwable) {
            return false;
        }
    }

    /**
     * Returns true when a kept value has the shape of the data value (HY-38): the same type, the same
     * keys of a map with conforming values, and list items that conform to the first data item. An
     * empty map or list gives no shape.
     */
    private static function conforms(mixed $value, mixed $current): bool
    {
        $kind = self::kind($current);
        if ($kind !== self::kind($value)) {
            return false;
        }
        if ($kind === 'map') {
            $data = $current instanceof \stdClass ? get_object_vars($current) : $current;
            $kept = $value instanceof \stdClass ? get_object_vars($value) : $value;
            if ($data === []) {
                return true;
            }
            if (count($kept) !== count($data)) {
                return false;
            }
            foreach ($data as $key => $item) {
                if (!array_key_exists($key, $kept) || !self::conforms($kept[$key], $item)) {
                    return false;
                }
            }

            return true;
        }
        if ($kind === 'list' && $current !== []) {
            foreach ($value as $item) {
                if (!self::conforms($item, $current[0])) {
                    return false;
                }
            }
        }

        return true;
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
