<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server\Tests\Support;

use Polyspec\Hyper\Server\Tests\CaseReader;

/** Reads one input of a case with the type that a step needs, and names the field in the failure. */
final class CaseInput
{
    public static function text(CaseReader $case, string $name): string
    {
        $value = $case->input($name);

        return is_string($value)
            ? $value
            : throw new \UnexpectedValueException("the case field {$name} is not a string");
    }

    public static function integer(CaseReader $case, string $name): int
    {
        $value = $case->input($name);

        return is_int($value)
            ? $value
            : throw new \UnexpectedValueException("the case field {$name} is not an integer");
    }

    /** @return array<array-key, mixed> */
    public static function map(CaseReader $case, string $name): array
    {
        return Json::map($case->input($name), "the case field {$name}");
    }
}
