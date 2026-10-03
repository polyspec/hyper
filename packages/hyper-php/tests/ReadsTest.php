<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\JsonEncoder;
use Polyspec\Hyper\Reads;

/** HY-73: the cases of conformance/reads.json, which the browser package and the Node server pass as well. */
final class ReadsTest extends TestCase
{
    public function testKeepsTheReadPathsOfEveryCase(): void
    {
        $fixture = json_decode((string) file_get_contents(__DIR__ . '/../../../conformance/reads.json'), flags: JSON_THROW_ON_ERROR);
        foreach ($fixture->cases as $case) {
            $reads = json_decode((string) json_encode($case->reads), true, flags: JSON_THROW_ON_ERROR);
            self::assertSame(
                JsonEncoder::encode(['kept' => self::value($case->kept)]),
                JsonEncoder::encode(['kept' => Reads::keep(self::value($case->data), $reads)]),
                $case->label,
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
