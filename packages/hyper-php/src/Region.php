<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** One manifest region: the page region, or a region with its own template and used topics (HY-2). */
final class Region
{
    /**
     * @param list<string> $uses
     * @param array<string, string> $keep kept path to its kind (HY-37)
     */
    public function __construct(
        public readonly string $name,
        public readonly bool $page,
        public readonly ?string $template,
        public readonly array $uses,
        public readonly array $keep = [],
    ) {
        foreach ($keep as $path => $kind) {
            if (preg_match('/^[A-Za-z_][A-Za-z0-9_]*(\.([A-Za-z_][A-Za-z0-9_]*|\d+))*$/D', (string) $path) !== 1 || !in_array($kind, Kept::KINDS, true)) {
                throw new \InvalidArgumentException("region {$name} has an invalid kept path {$path}");
            }
        }
        if ($page && $keep !== []) {
            throw new \InvalidArgumentException("page region {$name} cannot keep values");
        }
    }

    /**
     * Returns the kept paths of the given kinds.
     *
     * @param list<string> $kinds
     * @return list<string>
     */
    public function keptPaths(array $kinds): array
    {
        return array_keys(array_filter($this->keep, fn (string $kind): bool => in_array($kind, $kinds, true)));
    }

    /**
     * Returns true when this region uses one of the topics.
     *
     * @param list<string> $topics
     */
    public function usesAny(array $topics): bool
    {
        return array_intersect($this->uses, $topics) !== [];
    }
}
