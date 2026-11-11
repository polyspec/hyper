<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Fields;

/**
 * HY-56, HY-57: which bodies are read as fields, and the absent name. The cases of contracts/fields.json are run by the
 * case runner.
 */
final class FieldsTest extends TestCase
{
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
        self::assertSame(
            [['roles[]', ['a', 'b']]],
            self::pairs(
                Fields::fromBody('application/x-www-form-urlencoded; charset=UTF-8', 'roles%5B%5D=a&roles[]=b'),
            ),
        );
        self::assertSame([['a', ['1']]], self::pairs(Fields::fromBody('Application/X-WWW-Form-Urlencoded', 'a=1')));
        self::assertSame([], self::pairs(Fields::fromBody('text/plain', 'a=1')));
        self::assertSame([], self::pairs(Fields::fromBody('', 'a=1')));
        self::assertSame([], self::pairs(Fields::fromBody('multipart/form-data', '--x--')));
    }

    public function testAbsentNameHasNoValues(): void
    {
        $fields = Fields::parse('a=1');
        self::assertNotNull($fields);
        self::assertSame([], $fields->get('b'));
        $numeric = Fields::parse('1=x');
        self::assertNotNull($numeric);
        self::assertTrue($numeric->has('1'));
        self::assertFalse($numeric->has('2'));
    }
}
