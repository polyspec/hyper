<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\JsonEncoder;

/** HY-17, HY-44: the bytes of the numbers that the encoder writes, beyond the cases of contracts/json.json. */
final class JsonEncoderTest extends TestCase
{
    public function testAnIntegerOfTheSafeRangeEncodesInDecimal(): void
    {
        self::assertSame('{"v":9007199254740991}', JsonEncoder::encode(['v' => 9007199254740991]));
        self::assertSame('{"v":-7}', JsonEncoder::encode(['v' => -7]));
    }

    public function testNegativeZeroKeepsItsSign(): void
    {
        self::assertSame('{"v":-0}', JsonEncoder::encode(['v' => -0.0]));
        self::assertSame('{"v":0}', JsonEncoder::encode(['v' => 0]));
    }

    public function testANumberThatIsNotFiniteFails(): void
    {
        $this->expectException(\JsonException::class);
        JsonEncoder::encode(['v' => INF]);
    }
}
