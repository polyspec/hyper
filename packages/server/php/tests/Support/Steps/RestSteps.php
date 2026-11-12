<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server\Tests\Support\Steps;

use Polyspec\Hyper\Server\Tests\CaseReader;
use Polyspec\Hyper\Server\Tests\Support\CaseInput;

/** HY-49: the cases of contracts/rest.json. */
final class RestSteps
{
    public static function cases(CaseReader $case): void
    {
        $case->compare('result', RoutesSteps::route($case->input('routes'), CaseInput::text($case, 'path')));
    }

    public static function invalidPaths(CaseReader $case): void
    {
        $case->outcome('router', RoutesSteps::refusal(CaseInput::text($case, 'path')));
    }
}
