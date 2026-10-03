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
    /** @param array<string, array{shared: true|array<string, mixed>, regions: array<string, true|array<string, mixed>>}> $routes */
    private function __construct(private readonly array $routes)
    {
    }

    /** Reads `reads.json` of a server program. */
    public static function open(string $program): self
    {
        return new self(json_decode((string) file_get_contents("{$program}/reads.json"), true, flags: JSON_THROW_ON_ERROR)['routes']);
    }

    /**
     * Returns the shared data that a route keeps.
     *
     * @param array<string, mixed> $shared
     * @return array<string, mixed>
     */
    public function shared(string $route, array $shared): array
    {
        return self::keepMap($shared, $this->routes[$route]['shared']);
    }

    /**
     * Returns the data of a region that a route keeps.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    public function region(string $route, string $region, array $data): array
    {
        return self::keepMap($data, $this->routes[$route]['regions'][$region]);
    }

    /**
     * Returns the part of a value that a read node keeps: a map keeps the named keys and every key under `each`, an
     * empty map stays a map, a list keeps its length with null at an index that nothing names, and any other value
     * stays as it is.
     *
     * @param true|array<string, mixed> $node
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
        if (!is_array($value) || $value === []) {
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
     * @param array<string, mixed> $data
     * @param true|array<string, mixed> $node
     * @return array<string, mixed>
     */
    private static function keepMap(array $data, true|array $node): array
    {
        $kept = self::keep($data, $node);

        return $kept instanceof \stdClass ? [] : $kept;
    }

    /**
     * @param array<string, mixed> $node
     * @return true|array<string, mixed>|null
     */
    private static function child(array $node, string $key): true|array|null
    {
        $named = $node['keys'][$key] ?? null;
        $each = $node['each'] ?? null;
        if ($named === null || $each === null) {
            return $named ?? $each;
        }

        return self::merge($named, $each);
    }

    /**
     * @param true|array<string, mixed> $a
     * @param true|array<string, mixed> $b
     * @return true|array<string, mixed>
     */
    private static function merge(true|array $a, true|array $b): true|array
    {
        if ($a === true || $b === true) {
            return true;
        }
        $merged = [];
        if (isset($a['keys']) || isset($b['keys'])) {
            $keys = $a['keys'] ?? [];
            foreach ($b['keys'] ?? [] as $key => $node) {
                $keys[$key] = isset($keys[$key]) ? self::merge($keys[$key], $node) : $node;
            }
            $merged['keys'] = $keys;
        }
        if (isset($a['each']) || isset($b['each'])) {
            $merged['each'] = isset($a['each'], $b['each']) ? self::merge($a['each'], $b['each']) : ($a['each'] ?? $b['each']);
        }

        return $merged;
    }
}
