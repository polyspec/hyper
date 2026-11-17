<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Tests\Support\CaseRules;
use Polyspec\Hyper\Tests\Support\CaseSelection;
use Polyspec\Hyper\Tests\Support\CaseSteps;

/**
 * Runs every case of the case files that the PHP server runs (contracts/interfaces.json `caseFiles`) through its step,
 * and writes one result line per case to the file named by RECIPE_RESULTS (HYR-7). The file fails when a case fails.
 * A selection that names no case fails the test before a case runs, and no results file is written (HR-84).
 */
final class CaseRunnerTest extends TestCase
{
    public function testCases(): void
    {
        $results = getenv('RECIPE_RESULTS');
        if ($results === false || $results === '') {
            self::fail('RECIPE_RESULTS names no results file');
        }

        $cases = [];
        foreach (array_keys(CaseRules::caseFiles()) as $file) {
            array_push($cases, ...CaseReader::cases($file));
        }
        // With RECIPE_CASES the runner runs the cases that the selection names, and the first line of the results
        // file states the selection (H35.9-11); the caller names another results file than the one of a full run.
        $selection = getenv('RECIPE_CASES');
        $lines = [];
        if ($selection !== false) {
            $cases = CaseSelection::select(
                $selection,
                $cases,
                static fn (CaseReader $case): array => [$case->file(), $case->section(), $case->id()],
            );
            $lines[] = 'SELECTION ' . implode(' ', CaseSelection::names($selection));
        }

        $failed = 0;
        foreach ($cases as $case) {
            $file = $case->file();
            $section = $case->section();
            $step = CaseSteps::of($file, $section);
            try {
                if ($step === null) {
                    $case->fail("STEP_UNKNOWN $file $section");
                } else {
                    $step($case);
                }
            } catch (\Throwable $error) {
                $case->fail($error->getMessage());
            }
            $lines[] = $case->line();
            $failed += str_contains(end($lines), ' FAIL ') ? 1 : 0;
        }

        $directory = dirname($results);
        if (!is_dir($directory) && !mkdir($directory, 0777, true) && !is_dir($directory)) {
            self::fail("cannot create $directory");
        }
        $temporary = tempnam($directory, 'results.');
        if ($temporary === false || file_put_contents($temporary, implode("\n", $lines) . "\n") === false) {
            self::fail("cannot write the results file in $directory");
        }
        if (!rename($temporary, $results)) {
            self::fail("cannot rename the results file to $results");
        }

        self::assertSame(0, $failed, "$failed case(s) FAIL, see $results");
    }
}
