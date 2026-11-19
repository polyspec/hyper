<?php

declare(strict_types=1);

namespace Fixture\Tools;

/** A function of a file that the fixture's autoloader does not load, as a file the autoloader maps to no class. */
function loose(string $name): string
{
    return "loose {$name}";
}
