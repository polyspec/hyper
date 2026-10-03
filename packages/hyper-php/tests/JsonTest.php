<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\JsonEncoder;
use Polyspec\Hyper\Kept;
use Polyspec\Hyper\Tests\Support\Json;

/** HY-54: the JSON cases of conformance/json.json, which the Node server passes with the same bytes. */
final class JsonTest extends TestCase
{
    /** @return list<\stdClass> */
    private static function fixture(string $part): array
    {
        return Json::objects(Json::objectFile(__DIR__ . '/../../../conformance/json.json')->{$part});
    }

    /** @return iterable<string, array{string, string}> */
    public static function encodeCases(): iterable
    {
        foreach (self::fixture('encode') as $case) {
            yield Json::string($case->label) => [Json::string($case->json), Json::string($case->expected)];
        }
    }

    /** @return iterable<string, array{string, string}> */
    public static function decodeCases(): iterable
    {
        foreach (self::fixture('decode') as $case) {
            yield Json::string($case->label) => [Json::string($case->json), Json::string($case->result)];
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
