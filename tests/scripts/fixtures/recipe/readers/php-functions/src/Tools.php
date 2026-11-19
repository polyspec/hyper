<?php

declare(strict_types=1);

namespace Fixture\Tools;

/** Doubles a number: a public function that a file declares. */
function run(int $n): int
{
    return 2 * $n;
}

/**
 * A helper of the file that only the package uses.
 *
 * @internal
 */
function helper(int $n): int
{
    return $n + 1;
}
