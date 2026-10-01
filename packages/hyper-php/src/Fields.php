<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The values of a query or a form, without nesting: an ordered map from each name, in the order of its first
 * occurrence, to its values in request order (HY-56). Iteration yields every name as a string, also a decimal one.
 *
 * @implements \IteratorAggregate<string, list<string>>
 */
final class Fields implements \IteratorAggregate, \Countable
{
    /**
     * @param list<string> $names
     * @param array<array-key, list<string>> $values values by name
     */
    private function __construct(
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
     * Returns the names in the order of their first occurrence.
     *
     * @return list<string>
     */
    public function names(): array
    {
        return $this->names;
    }

    /** Returns true when the name has a value. */
    public function has(string $name): bool
    {
        return array_key_exists($name, $this->values);
    }

    /**
     * Returns the values of a name in request order; an absent name has none.
     *
     * @return list<string>
     */
    public function get(string $name): array
    {
        return $this->values[$name] ?? [];
    }

    /** Returns the last value of a name, or null. */
    public function last(string $name): ?string
    {
        $values = $this->get($name);

        return $values === [] ? null : $values[count($values) - 1];
    }

    /** @return \Generator<string, list<string>> */
    public function getIterator(): \Generator
    {
        foreach ($this->names as $name) {
            yield $name => $this->values[$name];
        }
    }

    public function count(): int
    {
        return count($this->names);
    }
}
