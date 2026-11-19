<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\Cookies;
use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\Bytes;
use Polyspec\Hyper\Tests\Support\Plain;

/** HY-129: the cases of contracts/cookies.json. */
final class CookiesSteps
{
    public static function parse(CaseReader $case): void
    {
        // Each line of a case is text whose characters U+0000 to U+00FF are its bytes, and `header` is one line, as a
        // host whose runtime joins the lines passes it (HY-129.15).
        $given = $case->has('lines') ? (array) $case->input('lines') : [$case->input('header')];
        $lines = [];
        foreach ($given as $line) {
            if (is_string($line)) {
                $lines[] = Bytes::of($line);
            }
        }
        $case->compare('cookies', Plain::map(Cookies::parse($lines)));
    }
}
