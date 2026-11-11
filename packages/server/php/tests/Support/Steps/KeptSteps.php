<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\Kept;
use Polyspec\Hyper\Tests\CaseReader;

/** HY-38, HY-41: the cases of contracts/keep.json. */
final class KeptSteps
{
    public static function cases(CaseReader $case): void
    {
        $data = $case->input('data');
        $kept = $case->input('kept');
        $case->compare('expected', Kept::apply(is_array($data) ? $data : [], is_array($kept) ? $kept : []));
    }
}
