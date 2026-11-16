<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Tests\Support\CaseRules;
use Polyspec\Hyper\Tests\Support\HyperValueError;

/**
 * The failure that a case step compares as `raises` (HY-132.2): only an error of hyper, whose classes include one named
 * Hyper<Category>Error; any other error is an error of the step and fails the case as it was raised.
 */
final class CaseRulesTest extends TestCase
{
    public function testAnErrorOfHyperIsRaises(): void
    {
        $failure = CaseRules::failureOf(static fn (): never => throw new HyperValueError('data_depth', 'too deep'));

        self::assertSame(
            [
                'result' => null,
                'raises' => ['kind' => 'data_depth', 'status' => null, 'category' => 'value', 'message' => 'too deep'],
            ],
            $failure,
        );
    }

    public function testAnErrorOfTheStepIsNoRaises(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('a step error');

        CaseRules::failureOf(static fn (): never => throw new \InvalidArgumentException('a step error'));
    }
}
