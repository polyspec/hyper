<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\Tests\CaseReader;

/** HY-49: the cases of contracts/rest.json. */
final class RestSteps
{
    public static function cases(CaseReader $case): void
    {
        $case->compare('result', RoutesSteps::route($case->input('routes'), (string) $case->input('path')));
    }

    public static function invalidPaths(CaseReader $case): void
    {
        $case->outcome('router', RoutesSteps::refusal((string) $case->input('path')));
    }
}
