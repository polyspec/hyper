<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\JsonEncoder;
use Polyspec\Hyper\Kept;

/** HY-54: the JSON cases of conformance/json.json, which the Node server passes with the same bytes. */
final class JsonTest extends TestCase
{
    /** @return object{encode: list<object{label: string, json: string, expected: string}>, decode: list<object{label: string, json: string, result: string}>} */
    private static function fixture(): object
    {
        return json_decode((string) file_get_contents(__DIR__ . '/../../../conformance/json.json'), false, flags: JSON_THROW_ON_ERROR);
    }

    /** @return iterable<string, array{string, string}> */
    public static function encodeCases(): iterable
    {
        foreach (self::fixture()->encode as $case) {
            yield $case->label => [$case->json, $case->expected];
        }
    }

    /** @return iterable<string, array{string, string}> */
    public static function decodeCases(): iterable
    {
        foreach (self::fixture()->decode as $case) {
            yield $case->label => [$case->json, $case->result];
        }
    }

    #[DataProvider('encodeCases')]
    public function testEncodesTheDecodedValue(string $json, string $expected): void
    {
        $value = json_decode($json, false, flags: JSON_THROW_ON_ERROR);

        self::assertSame('{"v":' . $expected . '}', JsonEncoder::encode(['v' => $value]));
    }

    #[DataProvider('decodeCases')]
    public function testDecodesKeptValues(string $json, string $result): void
    {
        // HY-38, HY-40: kept values are decoded with json_decode and checked against the data model.
        $value = json_decode($json, false);
        $actual = json_last_error() !== JSON_ERROR_NONE ? 'error' : (Kept::inDataModel($value) ? 'value' : 'outside');

        self::assertSame($result, $actual);
    }
}
