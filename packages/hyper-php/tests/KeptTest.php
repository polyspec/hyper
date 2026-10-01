<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Kept;

/** HY-41: these are the same cases that the JavaScript implementation passes. */
final class KeptTest extends TestCase
{
    /** @return iterable<string, array{array<string, mixed>, list<array{0: string, 1: mixed}>, array<string, mixed>}> */
    public static function cases(): iterable
    {
        $fixture = json_decode((string) file_get_contents(__DIR__ . '/../../../conformance/keep.json'), true, flags: JSON_THROW_ON_ERROR);
        foreach ($fixture['cases'] as $case) {
            yield $case['label'] => [$case['data'], $case['kept'], $case['expected']];
        }
    }

    /**
     * @param array<string, mixed> $data
     * @param list<array{0: string, 1: mixed}> $kept
     * @param array<string, mixed> $expected
     */
    #[DataProvider('cases')]
    public function testAppliesKeptValues(array $data, array $kept, array $expected): void
    {
        self::assertSame($expected, Kept::apply($data, $kept));
    }
}
