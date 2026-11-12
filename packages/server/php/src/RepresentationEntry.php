<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server;

/**
 * One declared representation of a route (HY-118): its type as the manifest writes it, its lower-case media type, its
 * required parameters, each a lower-case name with its served values, in declared order, its methods and its vary
 * names.
 *
 * @internal
 */
final class RepresentationEntry
{
    /**
     * @param list<array{0: string, 1: list<string>}> $parameters
     * @param list<string> $methods
     * @param list<string> $vary
     */
    public function __construct(
        public readonly string $type,
        public readonly string $media,
        public readonly array $parameters,
        public readonly array $methods,
        public readonly array $vary,
    ) {
    }
}
