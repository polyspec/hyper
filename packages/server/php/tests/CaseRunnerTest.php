<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Server\Tests\Support\CaseRules;
use Polyspec\Hyper\Server\Tests\Support\CaseSteps;

/**
 * Runs every case of the case files that the PHP server runs (contracts/interfaces.json `caseFiles`) through its step,
 * and writes one result line per case to the file named by RECIPE_RESULTS (HYR-7). The file fails when a case fails.
 */
final class CaseRunnerTest extends TestCase
{
    public function testCases(): void
    {
        $results = getenv('RECIPE_RESULTS');
        if ($results === false || $results === '') {
            self::fail('RECIPE_RESULTS names no results file');
        }

        $lines = [];
        $failed = 0;
        foreach (array_keys(CaseRules::caseFiles()) as $file) {
            foreach (CaseReader::cases($file) as $case) {
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
