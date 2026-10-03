<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** Values and changed topics that an action passes to the next request (HY-17). */
final class Flash
{
    /**
     * @param array<array-key, mixed> $values
     * @param list<string> $changed
     */
    public function __construct(
        public readonly array $values,
        public readonly array $changed,
    ) {
    }
}
