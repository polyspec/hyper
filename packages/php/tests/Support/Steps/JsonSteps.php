<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\JsonCodec;
use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\CaseRules;

/** HY-17, HY-54: the cases of contracts/json.json, the JSON text of a decoded value and the decoding of a text. */
final class JsonSteps
{
    public static function encode(CaseReader $case): void
    {
        $json = self::text($case);
        $outcome = CaseRules::failureOf(static fn (): string => JsonCodec::encode(JsonCodec::decode($json)));
        $case->compare('expected', $outcome['result']);
        $case->compare('raises', $outcome['raises']);
    }

    public static function decode(CaseReader $case): void
    {
        $json = self::text($case);
        $outcome = CaseRules::failureOf(static function () use ($json): string {
            JsonCodec::decode($json);

            return 'value';
        });
        $case->compare('result', $outcome['result']);
        $case->compare('raises', $outcome['raises']);
    }

    private static function text(CaseReader $case): string
    {
        $json = $case->input('json');

        return is_string($json) ? $json : '';
    }
}
