<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use Polyspec\Hyper\Tests\Steps\CsrfSteps;
use Polyspec\Hyper\Tests\Steps\MediaTypeSteps;

final class CaseSteps
{
    public static function of(string $file, string $section): \Closure
    {
        return match ("$file $section") {
            'csrf.json mask' => CsrfSteps::mask(...),
            'media-type.json essence' => MediaTypeSteps::essence(...),
        };
    }
}
