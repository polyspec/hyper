<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\Accept;
use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\CaseRules;

/** HY-116: the cases of contracts/accept.json, the parse of an Accept value and the selection of a media type. */
final class AcceptSteps
{
    public static function parse(CaseReader $case): void
    {
        $value = $case->input('accept');
        $accept = is_string($value) ? $value : null;
        $outcome = CaseRules::failureOf(static function () use ($accept): array {
            $plain = [];
            foreach (Accept::parse($accept) as $range) {
                $plain[] = (object) [
                    'type' => $range->type,
                    'subtype' => $range->subtype,
                    'parameters' => $range->parameters,
                    'weight' => $range->weight,
                ];
            }

            return $plain;
        });
        $case->compare('ranges', $outcome['result']);
        $case->compare('raises', $outcome['raises']);
    }

    public static function select(CaseReader $case): void
    {
        $value = $case->input('accept');
        $accept = is_string($value) ? $value : null;
        $listed = $case->input('types');
        $types = is_array($listed) ? array_values(array_filter($listed, is_string(...))) : [];
        // HY-116: the selection of the server, the best of the types among the parsed ranges.
        $outcome = CaseRules::failureOf(static fn (): mixed => Accept::best(Accept::parse($accept), $types)[0]);
        $case->compare('selected', $outcome['result']);
        $case->compare('raises', $outcome['raises']);
    }
}
