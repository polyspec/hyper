<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Tests\Support\CaseSelection;

/**
 * Tests CaseSelection, which gives the case runner the cases that RECIPE_CASES names (HR-84, H35.9-11): a name is a
 * case file, a section of a case file or a case id, and a name that selects no case fails with the selection.
 */
final class CaseSelectionTest extends TestCase
{
    private const array CASES = [
        ['reads.json', 'cases', 'first'],
        ['reads.json', 'errors', 'second'],
        ['app.json', 'opens', 'third'],
        ['app.json', 'cases', 'first'],
    ];

    /** @return list<string> the selected cases, each as `<file>#<section> <id>` */
    private static function selected(string $selection): array
    {
        return array_map(
            static fn (array $case): string => "{$case[0]}#{$case[1]} {$case[2]}",
            CaseSelection::select($selection, self::CASES, static fn (array $case): array => $case),
        );
    }

    public function testAFileNameSelectsTheCasesOfTheFile(): void
    {
        self::assertSame(['reads.json#cases first', 'reads.json#errors second'], self::selected('reads.json'));
    }

    public function testAFileAndASectionSelectTheCasesOfTheSection(): void
    {
        self::assertSame(['app.json#opens third'], self::selected('app.json#opens'));
    }

    public function testAnIdSelectsItsCasesInEveryFile(): void
    {
        self::assertSame(['reads.json#cases first', 'app.json#cases first'], self::selected('first'));
    }

    public function testSeveralNamesSelectEachCaseOnceInTheOrderOfTheRunner(): void
    {
        self::assertSame(
            ['reads.json#errors second', 'app.json#opens third'],
            self::selected(" app.json#opens\tsecond  reads.json#errors "),
        );
    }

    public function testANameThatSelectsNoCaseFailsWithTheSelection(): void
    {
        $this->expectException(\UnexpectedValueException::class);
        $this->expectExceptionMessage(
            'the selection "reads.json routes.json app.json#closes fourth" of the php runner selects no case for'
            . ' routes.json, app.json#closes, fourth',
        );

        self::selected('reads.json routes.json app.json#closes fourth');
    }

    public function testASelectionWithoutANameFails(): void
    {
        $this->expectException(\UnexpectedValueException::class);
        $this->expectExceptionMessage("the selection \" \t\" of the php runner names no case");

        self::selected(" \t");
    }

    public function testTheNamesOfASelectionAreItsWords(): void
    {
        self::assertSame(['reads.json', 'app.json#opens'], CaseSelection::names(" reads.json \n app.json#opens"));
    }
}
