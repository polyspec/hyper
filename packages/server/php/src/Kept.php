<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server;

/**
 * Kept values (HY-37, HY-38). Values outside the template data model are ignored; the cases of contracts/keep.json
 * hold the rules.
 *
 * @internal
 */
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
                $replaced = self::replaceAt($data, explode('.', $path), $value)[0];
                $data = is_array($replaced) ? $replaced : $data;
            }
        }

        return $data;
    }

    /**
     * Returns the kept values that conform to the data, by path (HY-17, HY-38), applying each one before the next.
     *
     * @param array<array-key, mixed> $data
     * @param list<array{0: string, 1: mixed}> $kept
     * @return array<string, mixed>
     */
    public static function select(array $data, array $kept): array
    {
        $selected = [];
        foreach ($kept as [$path, $value]) {
            if (!DataModel::contains($value)) {
                continue;
            }
            [$replaced, $applied] = self::replaceAt($data, explode('.', $path), $value);
            if ($applied) {
                $selected[$path] = $value;
            }
            $data = is_array($replaced) ? $replaced : $data;
        }

        return $selected;
    }

    /**
     * Returns the container with the value at the path of keys replaced when it conforms, and whether it replaced
     * the value; an absent path changes nothing. A list accepts only an index.
     *
     * @param list<string> $keys
     * @return array{0: mixed, 1: bool}
     */
    private static function replaceAt(mixed $container, array $keys, mixed $value): array
    {
        $key = $keys[0] ?? '';
        $rest = array_slice($keys, 1);
        if ($container instanceof \stdClass) {
            if (!property_exists($container, $key)) {
                return [$container, false];
            }
            $copy = clone $container;
            if ($rest === []) {
                if (!self::conforms($value, $copy->{$key})) {
                    return [$container, false];
                }
                $copy->{$key} = $value;

                return [$copy, true];
            }
            [$copy->{$key}, $applied] = self::replaceAt($copy->{$key}, $rest, $value);

            return [$copy, $applied];
        }
        if (!is_array($container)) {
            return [$container, false];
        }
        if (array_is_list($container) && $container !== []) {
            if (preg_match('/^\d+$/D', $key) !== 1) {
                return [$container, false];
            }
            $index = (int) $key;
        } else {
            $index = $key;
        }
        if (!array_key_exists($index, $container)) {
            return [$container, false];
        }
        if ($rest === []) {
            if (!self::conforms($value, $container[$index])) {
                return [$container, false];
            }
            $container[$index] = $value;

            return [$container, true];
        }
        [$container[$index], $applied] = self::replaceAt($container[$index], $rest, $value);

        return [$container, $applied];
    }

    /**
     * Returns true when a kept value has the shape of the data value (HY-38): the same type, the same
     * keys of a map with conforming values, and list items that conform to the first data item. An
     * empty map or list gives no shape.
     */
    private static function conforms(mixed $value, mixed $current): bool
    {
        if (self::valueKind($current) !== self::valueKind($value)) {
            return false;
        }
        $data = self::mapEntries($current);
        $kept = self::mapEntries($value);
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
    private static function mapEntries(mixed $value): ?array
    {
        return match (true) {
            $value instanceof \stdClass => get_object_vars($value),
            is_array($value) && !array_is_list($value) => $value,
            default => null,
        };
    }

    /** Returns the value type of the data model: null, bool, number, string, list or map. */
    private static function valueKind(mixed $value): string
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
