<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

use Polyspec\Hyper\Tests\CaseReader;

/** The step of each (file, section) of the case files that the PHP server runs. */
final class CaseSteps
{
    /** @return ?callable(CaseReader): void null when no step exists */
    public static function of(string $file, string $section): ?callable
    {
        return match ("$file $section") {
            default => null,
        };
    }
}
