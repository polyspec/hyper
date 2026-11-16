<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Context;
use Polyspec\Hyper\HyperValueError;

/** The failure of the context in the shared data (HY-124.8) is the error of hyper of its kind (HY-132.2). */
final class ContextTest extends TestCase
{
    public function testSharedDataThatHoldsTheContextFailsWithItsKind(): void
    {
        try {
            Context::withContext(['context' => []], ['name' => 'Board']);
        } catch (HyperValueError $error) {
            self::assertSame('shared_holds_context', $error->kind());
            self::assertNull($error->status());
            self::assertSame('the shared data already holds the member context (HY-128)', $error->getMessage());

            return;
        }
        self::fail('withContext returned although the shared data holds the member context');
    }
}
