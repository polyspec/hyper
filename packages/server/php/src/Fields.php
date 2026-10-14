<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The values of a query or a form, without nesting: an ordered map from each name, in the order of its first
 * occurrence, to its values in request order (HY-56, HY-57). Iteration yields every name as a string, also a decimal one.
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
     * Returns the fields of a request body: of an `application/x-www-form-urlencoded` body, or the text fields of a
     * `multipart/form-data` body; a body of another type has none (HY-57). Returns null when a name or a value is not
     * UTF-8 (HY-42).
     */
    public static function fromBody(string $type, string $body): ?self
    {
        if (preg_match('#^application/x-www-form-urlencoded\s*(;|$)#i', $type) === 1) {
            return self::parse($body);
        }
        if (preg_match('#^multipart/form-data\s*;#i', $type) === 1 && preg_match('#;\s*boundary=(?:"([^"]+)"|([^;\s]+))#i', $type, $found) === 1) {
            return self::multipart($body, $found[1] !== '' ? $found[1] : $found[2]);
        }

        return self::empty();
    }

    /** Reads the text fields of a multipart/form-data body; a file field is not a form value. */
    private static function multipart(string $body, string $boundary): ?self
    {
        $delimiter = "--{$boundary}";
        $names = [];
        $values = [];
        $start = strpos($body, $delimiter);
        while ($start !== false) {
            $partStart = $start + strlen($delimiter);
            if (substr($body, $partStart, 2) === '--') {
                break;
            }
            $next = strpos($body, $delimiter, $partStart);
            if ($next === false) {
                break;
            }
            $part = substr($body, $partStart + 2, $next - 2 - ($partStart + 2));
            $headerEnd = strpos($part, "\r\n\r\n");
            if ($headerEnd !== false) {
                $disposition = preg_match('/^content-disposition:\s*form-data(.*)$/im', substr($part, 0, $headerEnd), $found) === 1 ? rtrim($found[1], "\r") : '';
                if (preg_match('/;\s*name="([^"]*)"/i', $disposition, $name) === 1 && preg_match('/;\s*filename=/i', $disposition) !== 1) {
                    $value = substr($part, $headerEnd + 4);
                    if (preg_match('//u', $name[1]) !== 1 || preg_match('//u', $value) !== 1) {
                        return null;
                    }
                    if (!array_key_exists($name[1], $values)) {
                        $names[] = $name[1];
                        $values[$name[1]] = [];
                    }
                    $values[$name[1]][] = $value;
                }
            }
            $start = $next;
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
