<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\DataModel;
use Polyspec\Hyper\JsonEncoder;
use Polyspec\Hyper\Tests\CaseReader;

/** HY-38, HY-40: the cases of contracts/json.json. */
final class JsonSteps
{
    public static function encode(CaseReader $case): void
    {
        $value = json_decode((string) $case->input('json'), false, flags: JSON_THROW_ON_ERROR);
        $encoded = JsonEncoder::encode(['v' => $value]);
        // The case gives the value alone: the encoder's text is compared without its wrapping member.
        $prefix = '{"v":';
        $observed = str_starts_with($encoded, $prefix) && str_ends_with($encoded, '}')
            ? substr($encoded, strlen($prefix), -1)
            : $encoded;
        $case->compare('expected', $observed);
    }

    public static function decode(CaseReader $case): void
    {
        $value = json_decode((string) $case->input('json'), false);
        $result = json_last_error() !== JSON_ERROR_NONE ? 'error' : (DataModel::contains($value) ? 'value' : 'outside');
        $case->compare('result', $result);
    }
}
