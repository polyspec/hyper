<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server\Tests\Support\Steps;

use Polyspec\Hyper\Server\Cookies;
use Polyspec\Hyper\Server\Tests\CaseReader;
use Polyspec\Hyper\Server\Tests\Support\Bytes;
use Polyspec\Hyper\Server\Tests\Support\Plain;

/** HY-129: the cases of contracts/cookies.json. */
final class CookiesSteps
{
    public static function parse(CaseReader $case): void
    {
        $header = $case->input('header');
        // The header of a case is text whose characters U+0000 to U+00FF are its bytes (HY-129).
        $bytes = is_string($header) ? Bytes::of($header) : null;
        $case->compare('cookies', Plain::map(Cookies::parse($bytes)));
    }
}
