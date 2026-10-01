<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Fields;

/**
 * HY-56, HY-57: the cases of conformance/fields.json, which the Node server passes as well. A urlencoded text is the
 * UTF-8 encoding of its JSON string; a multipart body is text whose characters are its bytes.
 */
final class FieldsTest extends TestCase
{
    /** @return iterable<string, array{string, ?list<array{string, list<string>}>}> */
    public static function cases(): iterable
    {
        $fixture = json_decode((string) file_get_contents(__DIR__ . '/../../../conformance/fields.json'), true, flags: JSON_THROW_ON_ERROR);
        foreach ($fixture['urlencoded'] as $case) {
            yield $case['label'] => [$case['text'], $case['fields']];
        }
    }

    /** @return iterable<string, array{string, string, ?list<array{string, list<string>}>}> */
    public static function multipartCases(): iterable
    {
        $fixture = json_decode((string) file_get_contents(__DIR__ . '/../../../conformance/fields.json'), true, flags: JSON_THROW_ON_ERROR);
        foreach ($fixture['multipart'] as $case) {
            yield $case['label'] => [$case['type'], (string) mb_convert_encoding($case['body'], 'ISO-8859-1', 'UTF-8'), $case['fields']];
        }
    }

    /** @param ?list<array{string, list<string>}> $expected */
    #[DataProvider('multipartCases')]
    public function testReadsTheTextFieldsOfAMultipartBody(string $type, string $body, ?array $expected): void
    {
        self::assertSame($expected, self::pairs(Fields::fromBody($type, $body)));
    }

    /** @return ?list<array{string, list<string>}> */
    private static function pairs(?Fields $fields): ?array
    {
        if ($fields === null) {
            return null;
        }
        $pairs = [];
        foreach ($fields as $name => $values) {
            $pairs[] = [$name, $values];
        }

        return $pairs;
    }

    public function testReadsAUrlencodedBodyAndNoOtherType(): void
    {
        self::assertSame([['roles[]', ['a', 'b']]], self::pairs(Fields::fromBody('application/x-www-form-urlencoded; charset=UTF-8', 'roles%5B%5D=a&roles[]=b')));
        self::assertSame([['a', ['1']]], self::pairs(Fields::fromBody('Application/X-WWW-Form-Urlencoded', 'a=1')));
        self::assertSame([], self::pairs(Fields::fromBody('text/plain', 'a=1')));
        self::assertSame([], self::pairs(Fields::fromBody('', 'a=1')));
        self::assertSame([], self::pairs(Fields::fromBody('multipart/form-data', '--x--')));
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
