<?php

declare(strict_types=1);

namespace Fixture\Tools;

/** A class and a function of one file: the file is one unit, named by its file (HYR-3). */
final class Blend
{
    public function label(): string
    {
        return 'blend';
    }
}

function blend(): string
{
    return 'blend';
}
