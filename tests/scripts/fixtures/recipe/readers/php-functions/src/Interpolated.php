<?php

declare(strict_types=1);

namespace Fixture\Tools;

/** A class whose string interpolation comes before its static method, as App::run's class does. */
final class Interpolated
{
    public static function label(string $name): string
    {
        return "{$name}";
    }

    private static function checkedShell(string $name): string
    {
        return "shell {$name}";
    }
}
