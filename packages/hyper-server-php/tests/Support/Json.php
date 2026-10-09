<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

/**
 * Decodes the JSON of fixtures and responses and returns each value with the type that a test reads. A value of
 * another type fails the test with an exception.
 */
final class Json
{
    /**
     * Decodes a JSON file with objects as arrays.
     *
     * @return array<array-key, mixed>
     */
    public static function file(string $file): array
    {
        return self::array(json_decode(self::read($file), true, flags: JSON_THROW_ON_ERROR));
    }

    /** Decodes a JSON file with objects as `stdClass`. */
    public static function objectFile(string $file): \stdClass
    {
        return self::object(json_decode(self::read($file), false, flags: JSON_THROW_ON_ERROR));
    }

    /**
     * Decodes JSON text with objects as arrays.
     *
     * @return array<array-key, mixed>
     */
    public static function decode(string $json): array
    {
        return self::array(json_decode($json, true, flags: JSON_THROW_ON_ERROR));
    }

    /** @return array<array-key, mixed> */
    public static function array(mixed $value): array
    {
        if (!is_array($value)) {
            throw new \UnexpectedValueException('the JSON value is not an array: ' . get_debug_type($value));
        }

        return $value;
    }

    /** @return list<mixed> */
    public static function list(mixed $value): array
    {
        $array = self::array($value);
        if (!array_is_list($array)) {
            throw new \UnexpectedValueException('the JSON value is not a list');
        }

        return $array;
    }

    /** @return list<array<array-key, mixed>> */
    public static function arrays(mixed $value): array
    {
        return array_map(self::array(...), self::list($value));
    }

    /** @return list<\stdClass> */
    public static function objects(mixed $value): array
    {
        return array_map(self::object(...), self::list($value));
    }

    /** @return list<string> */
    public static function strings(mixed $value): array
    {
        return array_map(self::string(...), self::list($value));
    }

    /** @return array<string, string> */
    public static function stringMap(mixed $value): array
    {
        $map = [];
        foreach (self::array($value) as $key => $item) {
            if (!is_string($key)) {
                throw new \UnexpectedValueException("the JSON key {$key} is not a name");
            }
            $map[$key] = self::string($item);
        }

        return $map;
    }

    /**
     * Returns the value under a path of keys of nested arrays; a missing key fails.
     */
    public static function at(mixed $value, int|string ...$keys): mixed
    {
        foreach ($keys as $key) {
            $array = self::array($value);
            if (!array_key_exists($key, $array)) {
                throw new \UnexpectedValueException("the JSON value has no key {$key}");
            }
            $value = $array[$key];
        }

        return $value;
    }

    public static function object(mixed $value): \stdClass
    {
        if (!$value instanceof \stdClass) {
            throw new \UnexpectedValueException('the JSON value is not an object: ' . get_debug_type($value));
        }

        return $value;
    }

    public static function string(mixed $value): string
    {
        if (!is_string($value)) {
            throw new \UnexpectedValueException('the JSON value is not a string: ' . get_debug_type($value));
        }

        return $value;
    }

    private static function read(string $file): string
    {
        $text = file_get_contents($file);
        if ($text === false) {
            throw new \UnexpectedValueException("{$file} cannot be read");
        }

        return $text;
    }
}
