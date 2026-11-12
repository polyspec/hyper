<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server\Tests\Support\Steps;

use Polyspec\Hyper\Server\Accept;
use Polyspec\Hyper\Server\InvalidAccept;
use Polyspec\Hyper\Server\Tests\CaseReader;

/** HY-116: the cases of contracts/accept.json, the parse of an Accept value and the selection of a media type. */
final class AcceptSteps
{
    public static function parse(CaseReader $case): void
    {
        $value = $case->input('accept');
        try {
            $ranges = Accept::parse(is_string($value) ? $value : null);
        } catch (InvalidAccept) {
            $case->compare('invalid', true);

            return;
        }
        $plain = [];
        foreach ($ranges as $range) {
            $plain[] = (object) [
                'type' => $range->type,
                'subtype' => $range->subtype,
                'parameters' => $range->parameters,
                'weight' => $range->weight,
            ];
        }
        $case->compare('ranges', $plain);
    }

    public static function select(CaseReader $case): void
    {
        $value = $case->input('accept');
        $types = $case->input('types');
        try {
            $selected = Accept::select(
                is_string($value) ? $value : null,
                is_array($types) ? array_values(array_filter($types, is_string(...))) : [],
            );
        } catch (InvalidAccept) {
            $case->compare('invalid', true);

            return;
        }
        $case->compare('selected', $selected);
    }
}
