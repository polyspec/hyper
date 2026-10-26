<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The values of a query or a form, without nesting: an ordered map from each name, in the order of its first
 * occurrence, to its values in request order (HY-56, HY-57). Iteration yields every name as a string, also a decimal
 * one.
 *
 * @implements \IteratorAggregate<string, list<string>>
 *
 * @internal
 */
final class Fields implements \IteratorAggregate, \Countable
{
    /** @use NamedValues<string> */
    use NamedValues;

    /**
     * @param list<string> $names
     * @param array<array-key, list<string>> $values values by name
     */
    public function __construct(
        private readonly array $names,
        private readonly array $values,
    ) {
    }

    /** Returns fields without names. */
    public static function empty(): self
    {
        return new self([], []);
    }

    /**
     * Parses `name=value&name=value`: `+` is a space, `%XX` is its byte and another `%` stays. Returns null when a
     * name or a value is not UTF-8 (HY-42).
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
            $name = urldecode($equals === false ? $part : substr($part, 0, $equals));
            $value = urldecode($equals === false ? '' : substr($part, $equals + 1));
            if (preg_match('//u', $name) !== 1 || preg_match('//u', $value) !== 1) {
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
     * `multipart/form-data` body; a body of another type has none (HY-57). Returns null when a name or a value is not
     * UTF-8 (HY-42).
     */
    public static function fromBody(string $type, string $body): ?self
    {
        if (preg_match('#^application/x-www-form-urlencoded\s*(;|$)#i', $type) === 1) {
            return self::parse($body);
        }
        $boundary = Multipart::boundary($type);
        if ($boundary !== null) {
            // The text fields of the body; its file parts are read by Files (HY-113).
            $parts = Multipart::read($body, $boundary);

            return $parts === null ? null : $parts[0];
        }

        return self::empty();
    }

    /** Returns true when the name has a value. */
    public function has(string $name): bool
    {
        return array_key_exists($name, $this->values);
    }

    /** Returns the last value of a name, or null. */
    public function last(string $name): ?string
    {
        return $this->lastOf($name);
    }

    public function count(): int
    {
        return count($this->names);
    }
}
