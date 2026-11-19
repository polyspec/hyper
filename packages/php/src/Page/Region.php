<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * One manifest region: the page region, or a region with its own template (HY-2). The core selects the regions of a
 * response by their used topics from the manifest (HY-18, HY-19), so a region holds no topics.
 *
 * @internal
 */
final class Region
{
    /**
     * @param array<string, string> $keep kept path to its kind (HY-37)
     */
    public function __construct(
        public readonly string $name,
        public readonly bool $page,
        public readonly ?string $template,
        public readonly array $keep = [],
    ) {
        foreach ($keep as $path => $kind) {
            if (
                preg_match('/^[A-Za-z_][A-Za-z0-9_]*(\.([A-Za-z_][A-Za-z0-9_]*|\d+))*$/D', (string) $path) !== 1
                || !in_array($kind, Kept::KINDS, true)
            ) {
                throw new HyperValueError(
                    "region {$name} has an invalid kept path {$path}",
                    'invalid_application',
                );
            }
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
}
