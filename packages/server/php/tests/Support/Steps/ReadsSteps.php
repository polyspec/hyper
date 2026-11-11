<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\Reads;
use Polyspec\Hyper\Tests\CaseReader;

/**
 * HY-73: the cases of contracts/reads.json. A read node is true or a map; `templates`, `template` and `render` are
 * the browser and Node rendering, which PHP does not run.
 */
final class ReadsSteps
{
    public static function cases(CaseReader $case): void
    {
        // A read node is true or a map, and an empty map at any depth is an empty object, so it is read as an array.
        $node = json_decode(json_encode($case->input('reads'), JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR);
        $case->compare('kept', Reads::keep($case->input('data'), $node));
    }
}
