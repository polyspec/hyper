<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server\Tests\Steps;

use Polyspec\Hyper\Server\Csrf;
use Polyspec\Hyper\Server\Tests\CaseReader;

final class CsrfSteps
{
    public static function mask(CaseReader $case): void
    {
        $case->compare('expected', self::masked('token'));
    }

    private static function masked(string $token): string
    {
        return (new Csrf('k'))->mask($token);
    }
}
