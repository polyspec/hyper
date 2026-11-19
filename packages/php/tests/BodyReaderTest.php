<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\BodyReader;
use Polyspec\Hyper\HyperInternalError;

/**
 * The shape check of a form of the core (HY-133.6): fields and files that do not have the shape of the contract fail
 * with kind `internal`, and fields and files that have it pass unchanged.
 */
final class BodyReaderTest extends TestCase
{
    /** @return iterable<string, array{mixed, mixed}> */
    public static function brokenForms(): iterable
    {
        yield 'fields not a list' => [['a' => ['1']], []];
        yield 'fields pair of one item' => [[['a']], []];
        yield 'fields name not text' => [[[1, ['1']]], []];
        yield 'fields value not text' => [[['a', [1]]], []];
        yield 'fields values not a list' => [[['a', 'x']], []];
        yield 'files not an array' => [[], 'x'];
        yield 'files item not a core file' => [[], [['f', ['bytes']]]];
    }

    #[DataProvider('brokenForms')]
    public function testFormWithoutTheShapeOfTheContractFailsWithKindInternal(mixed $fields, mixed $files): void
    {
        try {
            BodyReader::shaped($fields, $files);
            self::fail('a form without the shape of the contract passed');
        } catch (HyperInternalError $error) {
            self::assertSame('internal', $error->kind());
        }
    }

    public function testFormWithTheShapeOfTheContractPasses(): void
    {
        $fields = [['a', ['1', '2']], ['b', []]];

        self::assertSame([$fields, [['f', []]]], BodyReader::shaped($fields, [['f', []]]));
    }
}
