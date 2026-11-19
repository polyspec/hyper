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
            $pairs = parseUrlencoded($text);
        } catch (HyperValueError) {
            return null;
        }
        $names = [];
        $values = [];
        foreach ($pairs as [$name, $items]) {
            $names[] = $name;
            $values[$name] = $items;
        }

        return new self($names, $values);
    }
}
