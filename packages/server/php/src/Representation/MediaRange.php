<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * One media range of an Accept value (RFC 9110, section 12.5.1): its type and subtype in lower case (`*` for a
 * wildcard), its parameters before `q` as [name, value] pairs in their order with the name in lower case, and its
 * weight in thousandths, 0 to 1000 (HY-116).
 *
 * @internal
 */
final class MediaRange
{
    /** @param list<array{0: string, 1: string}> $parameters */
    public function __construct(
        public readonly string $type,
        public readonly string $subtype,
        public readonly array $parameters,
        public readonly int $weight,
    ) {
    }
}
