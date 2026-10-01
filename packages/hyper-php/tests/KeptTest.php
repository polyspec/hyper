<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Kept;

/**
 * HY-41: these are the same cases that the JavaScript implementation passes. The fixture is decoded
 * with objects, so an empty map stays a map; region data is converted the way loaders return it:
 * arrays for lists and non-empty maps, `stdClass` for empty maps.
 */
final class KeptTest extends TestCase
{
    /** @return iterable<string, array{array<string, mixed>, list<array{0: string, 1: mixed}>, string}> */
    public static function cases(): iterable
    {
        $fixture = json_decode((string) file_get_contents(__DIR__ . '/../../../conformance/keep.json'), false, flags: JSON_THROW_ON_ERROR);
        foreach ($fixture->cases as $case) {
            $kept = array_map(fn (array $pair): array => [$pair[0], $pair[1]], $case->kept);
            yield $case->label => [self::loaderData($case->data), $kept, json_encode($case->expected)];
        }
    }

    /**
     * @param array<string, mixed> $data
     * @param list<array{0: string, 1: mixed}> $kept
     */
    #[DataProvider('cases')]
    public function testAppliesKeptValues(array $data, array $kept, string $expected): void
    {
        self::assertSame($expected, json_encode(Kept::apply($data, $kept)));
    }

    public function testWalksIntoStdClassMaps(): void
    {
        $data = Kept::apply(['notice' => (object) ['closed' => false]], [['notice.closed', true]]);

        self::assertSame('{"notice":{"closed":true}}', json_encode($data));
    }

    private static function loaderData(mixed $value): mixed
    {
        if ($value instanceof \stdClass) {
            $map = get_object_vars($value);

            return $map === [] ? new \stdClass() : array_map(self::loaderData(...), $map);
        }

        return is_array($value) ? array_map(self::loaderData(...), $value) : $value;
    }
}
