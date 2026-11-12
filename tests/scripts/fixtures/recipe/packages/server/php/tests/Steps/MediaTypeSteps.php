<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Steps;

use Polyspec\Hyper\Tests\CaseReader;

final class MediaTypeSteps
{
    public static function essence(CaseReader $case): void
    {
        $reader = new EssenceReader();
        $case->compare('expected', $reader->read('text/plain'));
    }
}
