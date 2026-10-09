<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** Kept values (HY-37, HY-38). Values outside the template data model are ignored. The JavaScript implementation follows the same rules; both pass conformance/keep.json. */
final class Kept
{
    public const KINDS = ['server', 'cookie', 'localStorage', 'sessionStorage'];

    /**
     * Replaces values at kept paths when the path exists and the kept value conforms to its value.
     *
     * @param array<array-key, mixed> $data
     * @param list<array{0: string, 1: mixed}> $kept
     * @return array<array-key, mixed>
     */
    public static function apply(array $data, array $kept): array
    {
        foreach ($kept as [$path, $value]) {
            if (DataModel::contains($value)) {
                $applied = false;
                $data = self::replaceInArray($data, explode('.', $path), $value, $applied);
            }
        }

        return $data;
    }

    /**
     * Returns the kept values that conform to the data, by path (HY-17, HY-38).
     *
     * @param array<array-key, mixed> $data
     * @param list<array{0: string, 1: mixed}> $kept
     * @return array<string, mixed>
     */
    public static function select(array $data, array $kept): array
    {
        $selected = [];
        foreach ($kept as [$path, $value]) {
            $applied = false;
            if (DataModel::contains($value)) {
                $data = self::replaceInArray($data, explode('.', $path), $value, $applied);
            }
            if ($applied) {
                $selected[$path] = $value;
            }
        }

        return $selected;
    }

    /** @param non-empty-list<string> $keys */
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

        return is_array($container) ? self::replaceInArray($container, $keys, $value, $applied) : $container;
    }

    /**
     * @param array<array-key, mixed> $container
     * @param non-empty-list<string> $keys
     * @return array<array-key, mixed>
     */
    private static function replaceInArray(array $container, array $keys, mixed $value, bool &$applied): array
    {
        $key = $keys[0];
        $rest = array_slice($keys, 1);
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
        if ($rest === []) {
            if (self::conforms($value, $container[$index])) {
                $container[$index] = $value;
                $applied = true;
            }

            return $container;
        }
        $container[$index] = self::replace($container[$index], $rest, $value, $applied);

        return $container;
    }


    /**
     * Returns true when a kept value has the shape of the data value (HY-38): the same type, the same
     * keys of a map with conforming values, and list items that conform to the first data item. An
     * empty map or list gives no shape.
     */
    private static function conforms(mixed $value, mixed $current): bool
    {
        if (self::kind($current) !== self::kind($value)) {
            return false;
        }
        $data = self::entries($current);
        $kept = self::entries($value);
        if ($data !== null && $kept !== null) {
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
        if (is_array($current) && array_is_list($current) && $current !== [] && is_array($value)) {
            foreach ($value as $item) {
                if (!self::conforms($item, $current[0])) {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Returns the entries of a map of the data model, or null for another value.
     *
     * @return array<array-key, mixed>|null
     */
    private static function entries(mixed $value): ?array
    {
        return match (true) {
            $value instanceof \stdClass => get_object_vars($value),
            is_array($value) && !array_is_list($value) => $value,
            default => null,
        };
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
