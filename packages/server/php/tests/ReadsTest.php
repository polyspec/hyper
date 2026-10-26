<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\JsonEncoder;
use Polyspec\Hyper\Reads;
use Polyspec\Hyper\Tests\Support\Json;

/** HY-73: the cases of contracts/reads.json, which the browser package and the Node server pass as well. */
final class ReadsTest extends TestCase
{
    /** @return iterable<string, array{mixed, array<array-key, mixed>|true, mixed}> */
    public static function cases(): iterable
    {
        $fixture = Json::objectFile(__DIR__ . '/../../../../contracts/reads.json');
        foreach (Json::objects($fixture->cases) as $case) {
            // A read node is true or a map, which the server reads from reads.json with objects as arrays.
            $reads = $case->reads === true ? true : Json::decode(json_encode($case->reads, JSON_THROW_ON_ERROR));
            yield Json::string($case->id) => [self::value($case->data), $reads, self::value($case->kept)];
        }
    }

    /** @param array<array-key, mixed>|true $reads */
    #[DataProvider('cases')]
    public function testKeepsTheReadPathsOfEveryCase(mixed $data, array|true $reads, mixed $kept): void
    {
        self::assertSame(
            JsonEncoder::encode(['kept' => $kept]),
            JsonEncoder::encode(['kept' => Reads::keep($data, $reads)]),
        );
    }

    /** Returns a decoded JSON value with non-empty objects as arrays and empty objects as stdClass, as data has them. */
    private static function value(mixed $value): mixed
    {
        if ($value instanceof \stdClass) {
            $map = array_map(self::value(...), get_object_vars($value));

            return $map === [] ? new \stdClass() : $map;
        }

        return is_array($value) ? array_map(self::value(...), $value) : $value;
    }
}
