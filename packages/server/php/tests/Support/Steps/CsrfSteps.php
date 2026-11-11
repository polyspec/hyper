<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\Csrf;
use Polyspec\Hyper\Tests\CaseReader;

/** HY-24: the cases of contracts/csrf.json. */
final class CsrfSteps
{
    public static function mask(CaseReader $case): void
    {
        $case->compare('value', Csrf::mask($case->input('token'), $case->input('mask')));
    }

    public static function verify(CaseReader $case): void
    {
        $case->compare('valid', Csrf::verify($case->input('token'), $case->input('value')));
    }
}
