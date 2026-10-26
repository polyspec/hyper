<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The names of a request part in the order of their first occurrence and its values by name, which Fields and Files
 * hold (HY-113): the class that uses it declares `$names` and `$values`.
 *
 * @template T
 *
 * @internal
 */
trait NamedValues
{
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

    /** @return \Generator<string, list<T>> */
    public function getIterator(): \Generator
    {
        foreach ($this->names as $name) {
            yield $name => $this->values[$name];
        }
    }

    /**
     * Returns the last value of a name, or null.
     *
     * @return T|null
     */
    private function lastOf(string $name): mixed
    {
        $values = $this->get($name);

        return $values === [] ? null : $values[count($values) - 1];
    }
}
