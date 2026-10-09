<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\JsonEncoder;
use Polyspec\Hyper\Reads;
use Polyspec\Hyper\Tests\Support\Json;

/** HY-73: the cases of conformance/reads.json, which the browser package and the Node server pass as well. */
final class ReadsTest extends TestCase
{
    public function testKeepsTheReadPathsOfEveryCase(): void
    {
        $fixture = Json::objectFile(__DIR__ . '/../../../conformance/reads.json');
        foreach (Json::objects($fixture->cases) as $case) {
            // A read node is true or a map, which the server reads from reads.json with objects as arrays.
            $reads = $case->reads === true ? true : Json::decode(json_encode($case->reads, JSON_THROW_ON_ERROR));
            self::assertSame(
                JsonEncoder::encode(['kept' => self::value($case->kept)]),
                JsonEncoder::encode(['kept' => Reads::keep(self::value($case->data), $reads)]),
                Json::string($case->label),
            );
        }
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
