<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The read paths of the routes, which `scripts/build-server.mjs` writes to `reads.json`, and the data that they keep
 * (HY-73). A read node is `true` when the value at its path is read whole, and otherwise names the keys read below it
 * and, under `each`, what is read of every entry of a map or element of a list.
 */
final class Reads
{
    /** @param array<mixed> $routes the read nodes of each route by route name */
    private function __construct(private readonly array $routes)
    {
    }

    /** Reads `reads.json` of a server program. */
    public static function open(string $program): self
    {
        $file = "{$program}/reads.json";
        $reads = json_decode((string) file_get_contents($file), true, flags: JSON_THROW_ON_ERROR);
        if (!is_array($reads) || !is_array($reads['routes'] ?? null)) {
            throw new \InvalidArgumentException("{$file} has no routes");
        }

        return new self($reads['routes']);
    }

    /**
     * Returns the shared data that a route keeps.
     *
     * @param array<array-key, mixed> $shared
     * @return array<array-key, mixed>
     */
    public function shared(string $route, array $shared): array
    {
        $entry = $this->routes[$route] ?? null;

        return self::keepMap($shared, self::node(is_array($entry) ? $entry['shared'] ?? null : null));
    }

    /**
     * Returns the data of a region that a route keeps.
     *
     * @param array<array-key, mixed> $data
     * @return array<array-key, mixed>
     */
    public function region(string $route, string $region, array $data): array
    {
        $entry = $this->routes[$route] ?? null;
        $regions = is_array($entry) ? $entry['regions'] ?? null : null;

        return self::keepMap($data, self::node(is_array($regions) ? $regions[$region] ?? null : null));
    }

    /**
     * Returns the part of a value that a read node keeps: a map keeps the named keys and every key under `each`, an
     * empty map stays a map, a list keeps its length with null at an index that nothing names, and any other value
     * stays as it is.
     *
     * @param true|array<mixed> $node
     */
    public static function keep(mixed $value, true|array $node): mixed
    {
        if ($node === true) {
            return $value;
        }
        if ($value instanceof \stdClass) {
            $value = get_object_vars($value);
            if ($value === []) {
                return new \stdClass();
            }
        }

        return is_array($value) ? self::keepArray($value, $node) : $value;
    }

    /**
     * @param array<array-key, mixed> $value
     * @param array<mixed> $node
     * @return array<array-key, mixed>|\stdClass
     */
    private static function keepArray(array $value, array $node): array|\stdClass
    {
        if ($value === []) {
            return $value;
        }
        if (array_is_list($value)) {
            $kept = [];
            foreach ($value as $index => $item) {
                $child = self::child($node, (string) $index);
                $kept[] = $child === null ? null : self::keep($item, $child);
            }

            return $kept;
        }
        $kept = [];
        foreach ($value as $key => $item) {
            $child = self::child($node, (string) $key);
            if ($child !== null) {
                $kept[$key] = self::keep($item, $child);
            }
        }

        return $kept === [] ? new \stdClass() : $kept;
    }

    /**
     * @param array<array-key, mixed> $data
     * @param true|array<mixed> $node
     * @return array<array-key, mixed>
     */
    private static function keepMap(array $data, true|array $node): array
    {
        if ($node === true) {
            return $data;
        }
        $kept = self::keepArray($data, $node);

        return $kept instanceof \stdClass ? [] : $kept;
    }

    /**
     * Returns a read node of `reads.json`, which is true or a map; another value fails.
     *
     * @return true|array<mixed>
     */
    private static function node(mixed $node): true|array
    {
        if ($node === true || is_array($node)) {
            return $node;
        }

        throw new \UnexpectedValueException('reads.json has a read node that is neither true nor a map');
    }

    /**
     * Returns the nodes of the named keys of a node, or null when it names no key.
     *
     * @param array<mixed> $node
     * @return array<mixed>|null
     */
    private static function keys(array $node): ?array
    {
        $keys = $node['keys'] ?? null;
        if ($keys !== null && !is_array($keys)) {
            throw new \UnexpectedValueException('reads.json has keys that are not a map');
        }

        return $keys;
    }

    /**
     * Returns the node of every entry of a node, or null when it has none.
     *
     * @param array<mixed> $node
     * @return true|array<mixed>|null
     */
    private static function each(array $node): true|array|null
    {
        $each = $node['each'] ?? null;

        return $each === null ? null : self::node($each);
    }

    /**
     * @param array<mixed> $node
     * @return true|array<mixed>|null
     */
    private static function child(array $node, string $key): true|array|null
    {
        $named = self::keys($node)[$key] ?? null;
        $named = $named === null ? null : self::node($named);
        $each = self::each($node);
        if ($named === null || $each === null) {
            return $named ?? $each;
        }

        return self::merge($named, $each);
    }

    /**
     * @param true|array<mixed> $a
     * @param true|array<mixed> $b
     * @return true|array<mixed>
     */
    private static function merge(true|array $a, true|array $b): true|array
    {
        if ($a === true || $b === true) {
            return true;
        }
        $merged = [];
        $aKeys = self::keys($a);
        $bKeys = self::keys($b);
        if ($aKeys !== null || $bKeys !== null) {
            $keys = $aKeys ?? [];
            foreach ($bKeys ?? [] as $key => $node) {
                $node = self::node($node);
                $keys[$key] = isset($keys[$key]) ? self::merge(self::node($keys[$key]), $node) : $node;
            }
            $merged['keys'] = $keys;
        }
        $aEach = self::each($a);
        $bEach = self::each($b);
        if ($aEach !== null || $bEach !== null) {
            $merged['each'] = $aEach !== null && $bEach !== null ? self::merge($aEach, $bEach) : ($aEach ?? $bEach);
        }

        return $merged;
    }
}
