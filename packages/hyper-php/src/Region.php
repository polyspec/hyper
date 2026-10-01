<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** One manifest region: the page region, or a region with its own template and used topics (HY-2). */
final class Region
{
    /** @param list<string> $uses */
    public function __construct(
        public readonly string $name,
        public readonly bool $page,
        public readonly ?string $template,
        public readonly array $uses,
    ) {
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
