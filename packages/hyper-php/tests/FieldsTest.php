<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Fields;

/** HY-56: the cases of conformance/fields.json, which the Node server passes as well. */
final class FieldsTest extends TestCase
{
    /** @return iterable<string, array{string, ?list<array{string, list<string>}>}> */
    public static function cases(): iterable
    {
        $fixture = json_decode((string) file_get_contents(__DIR__ . '/../../../conformance/fields.json'), true, flags: JSON_THROW_ON_ERROR);
        foreach ($fixture['cases'] as $case) {
            yield $case['label'] => [$case['text'], $case['fields']];
        }
    }

    /** @param ?list<array{string, list<string>}> $expected */
    #[DataProvider('cases')]
    public function testParsesTheTextWithoutNesting(string $text, ?array $expected): void
    {
        $fields = Fields::parse($text);
        if ($expected === null) {
            self::assertNull($fields);

            return;
        }
        self::assertNotNull($fields);
        $actual = [];
        foreach ($fields as $name => $values) {
            $actual[] = [$name, $values];
        }
        self::assertSame($expected, $actual);
        self::assertSame(array_column($expected, 0), $fields->names());
        foreach ($expected as [$name, $values]) {
            self::assertSame($values, $fields->get($name));
        }
    }

    public function testAbsentNameHasNoValues(): void
    {
        self::assertSame([], Fields::parse('a=1')?->get('b'));
        self::assertTrue((bool) Fields::parse('1=x')?->has('1'));
        self::assertFalse((bool) Fields::parse('1=x')?->has('2'));
    }
}
