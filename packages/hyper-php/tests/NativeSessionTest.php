<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\Attributes\RunInSeparateProcess;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\NativeSession;

/** HY-45: the PHP session starts only when a request reads or writes session data. */
final class NativeSessionTest extends TestCase
{
    #[RunInSeparateProcess]
    public function testStartsTheSessionOnFirstUse(): void
    {
        $store = new NativeSession(false);
        self::assertSame(PHP_SESSION_NONE, session_status());

        $store->set('a', 1);
        self::assertSame(PHP_SESSION_ACTIVE, session_status());
        self::assertSame(1, $store->get('a'));
    }
}
