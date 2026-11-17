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
     * Parses `name=value&name=value` through `parseUrlencoded` of the core, which reads it with http-form: `+` is a
     * space, `%XX` is its byte and another `%` stays. Returns null when a name or a value is not UTF-8 (HY-42, HY-56).
     */
    public static function parse(string $text): ?self
    {
        try {
            return self::read($text);
        } catch (HyperValueError) {
            return null;
        }
    }

    /**
     * Parses the text as `parse` does, and fails with the error of the core, kind `invalid` of http-form, where
     * `parse` returns null (HY-42, HY-56).
     *
     * @internal
     */
    public static function read(string $text): self
    {
        $pairs = parseUrlencoded($text);
        $names = [];
        $values = [];
        foreach ($pairs as [$name, $items]) {
            $names[] = $name;
            $values[$name] = $items;
        }

        return new self($names, $values);
    }

    /**
     * Returns the fields of a request body: of an `application/x-www-form-urlencoded` body, or the text fields of a
     * `multipart/form-data` body; a body of another type has none (HY-57). Returns null when a part of the body fails
     * (HY-113.15, HY-113.23, HY-113.25).
     */
    public static function fromBody(string $type, string $body): ?self
    {
        return Files::heldForm($type, $body)[0] ?? null;
    }
}
