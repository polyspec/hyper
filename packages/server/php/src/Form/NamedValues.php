<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The names of a request part in the order of their first occurrence and the values of each name in request order,
 * which Fields and Files hold (HY-56, HY-57, HY-113).
 *
 * @template T
 *
 * @internal
 */
abstract class NamedValues
{
    /**
     * @param list<string> $names
     * @param array<array-key, list<T>> $values values by name, whose decimal names PHP keeps as integer keys
     */
    public function __construct(
        private readonly array $names,
        private readonly array $values,
    ) {
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

    /**
     * Returns the values of a name in request order; an absent name has none.
     *
     * @return list<T>
     */
    public function get(string $name): array
    {
        return $this->values[$name] ?? [];
    }

    /**
     * Returns the last value of a name, or null.
     *
     * @return T|null
     */
    public function last(string $name): mixed
    {
        $values = $this->values[$name] ?? [];

        return $values === [] ? null : $values[count($values) - 1];
    }

    /**
     * Returns each name with its values, in the order of the names; a pair keeps a decimal name a string (HY-56.4).
     *
     * @return list<array{string, list<T>}>
     */
    public function pairs(): array
    {
        return array_map(fn (string $name): array => [$name, $this->get($name)], $this->names);
    }
}
