<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server\Tests\Support\Steps;

use Polyspec\Hyper\Server\Kept;
use Polyspec\Hyper\Server\Tests\CaseReader;
use Polyspec\Hyper\Server\Tests\Support\Plain;

/**
 * HY-38: the cases of contracts/keep.json. The data of a case is given as arrays and as the stdClass maps of decoded
 * JSON, and both must give the expected values.
 */
final class KeepSteps
{
    public static function cases(CaseReader $case): void
    {
        [$arrays, $objects, $kept] = self::inputs($case);
        $applied = Kept::apply($arrays, $kept);
        if (Plain::value(Kept::apply($objects, $kept)) != Plain::value($applied)) {
            $case->fail('the stdClass maps of the data give other values than its arrays');
        }
        $case->compare('expected', Plain::map($applied));
    }

    public static function select(CaseReader $case): void
    {
        [$arrays, $objects, $kept] = self::inputs($case);
        $before = serialize($objects);
        $selected = Kept::select($arrays, $kept);
        if (Plain::value(Kept::select($objects, $kept)) != Plain::value($selected)) {
            $case->fail('the stdClass maps of the data select other values than its arrays');
        }
        $case->compare('selected', Plain::map($selected));
        $case->compare('unchanged', serialize($objects) === $before);
    }

    /** @return array{0: array<array-key, mixed>, 1: array<array-key, mixed>, 2: list<array{0: string, 1: mixed}>} */
    private static function inputs(CaseReader $case): array
    {
        $data = $case->input('data');
        $arrays = is_array($data) ? $data : [];
        $text = json_encode((object) $arrays, JSON_THROW_ON_ERROR);
        $objects = (array) json_decode($text, false, 512, JSON_THROW_ON_ERROR);
        $kept = [];
        foreach (is_array($case->input('kept')) ? $case->input('kept') : [] as $pair) {
            if (is_array($pair) && is_string($pair[0] ?? null) && array_key_exists(1, $pair)) {
                $kept[] = [$pair[0], $pair[1]];
            }
        }

        return [$arrays, $objects, $kept];
    }
}
