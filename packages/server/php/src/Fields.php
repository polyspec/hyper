<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The values of a query or a form, without nesting: each name, in the order of its first occurrence, with its values
 * in request order; a bracketed name is the name as written (HY-56, HY-57).
 *
 * @extends NamedValues<string>
 *
 * @internal
 */
final class Fields extends NamedValues
{
    /** Returns fields without names. */
    public static function empty(): self
    {
        return new self([], []);
    }

    /**
     * Parses `name=value&name=value`: `+` is a space, `%XX` is its byte and another `%` stays. Returns null when a
     * name or a value is not UTF-8 (HY-42, HY-56).
     */
    public static function parse(string $text): ?self
    {
        $names = [];
        $values = [];
        foreach (explode('&', $text) as $part) {
            if ($part === '') {
                continue;
            }
            $equals = strpos($part, '=');
            $name = self::percentDecoded($equals === false ? $part : substr($part, 0, $equals));
            $value = self::percentDecoded($equals === false ? '' : substr($part, $equals + 1));
            if ($name === null || $value === null) {
                return null;
            }
            if (!array_key_exists($name, $values)) {
                $names[] = $name;
                $values[$name] = [];
            }
            $values[$name][] = $value;
        }

        return new self($names, $values);
    }

    /**
     * Returns the fields of a request body: of an `application/x-www-form-urlencoded` body, or the text fields of a
     * `multipart/form-data` body; a body of another type has none (HY-57). Returns null when a part of the body fails
     * with HY-42 (HY-113.15).
     */
    public static function fromBody(string $type, string $body): ?self
    {
        if (preg_match('#^application/x-www-form-urlencoded[ \t]*(;|$)#iD', $type) === 1) {
            return self::parse($body);
        }
        $boundary = Multipart::boundary($type);
        if ($boundary === null) {
            return self::empty();
        }

        return Multipart::read($body, $boundary)[0] ?? null;
    }

    /**
     * Decodes `+` to a space and `%XX` to its byte, and returns the bytes when they are UTF-8, or null.
     */
    private static function percentDecoded(string $text): ?string
    {
        $decoded = urldecode($text);

        return preg_match('//u', $decoded) === 1 ? $decoded : null;
    }
}
