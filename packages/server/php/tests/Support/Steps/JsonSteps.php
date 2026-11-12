<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server\Tests\Support\Steps;

use Polyspec\Hyper\Server\JsonCodec;
use Polyspec\Hyper\Server\JsonDecodeError;
use Polyspec\Hyper\Server\Tests\CaseReader;

/** HY-17, HY-54: the cases of contracts/json.json, the JSON text of a decoded value and the decoding of a text. */
final class JsonSteps
{
    public static function encode(CaseReader $case): void
    {
        $case->compare('expected', JsonCodec::encode(JsonCodec::decode(self::text($case))));
    }

    public static function decode(CaseReader $case): void
    {
        try {
            $result = JsonCodec::inDataModel(JsonCodec::decode(self::text($case))) ? 'value' : 'outside';
        } catch (JsonDecodeError) {
            $result = 'error';
        }
        $case->compare('result', $result);
    }

    private static function text(CaseReader $case): string
    {
        $json = $case->input('json');

        return is_string($json) ? $json : '';
    }
}
