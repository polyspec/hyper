<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\Attributes\RunInSeparateProcess;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\NativeSession;

/** HY-45, HY-72: the PHP session starts only when a request reads or writes session data, under the name that hyper sets. */
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

    #[RunInSeparateProcess]
    public function testNamesTheCookieHySessionOverHttp(): void
    {
        (new NativeSession(false))->set('a', 1);

        self::assertSame('hy-session', session_name());
        self::assertSame(['path' => '/', 'domain' => '', 'secure' => false, 'httponly' => true, 'samesite' => 'Lax'], array_intersect_key(session_get_cookie_params(), array_flip(['path', 'domain', 'secure', 'httponly', 'samesite'])));
    }

    #[RunInSeparateProcess]
    public function testNamesTheCookieWithTheHostPrefixOverHttps(): void
    {
        (new NativeSession(true))->set('a', 1);

        self::assertSame('__Host-hy-session', session_name());
        self::assertSame(['path' => '/', 'domain' => '', 'secure' => true], array_intersect_key(session_get_cookie_params(), array_flip(['path', 'domain', 'secure'])));
    }

    #[RunInSeparateProcess]
    public function testRenewsTheIdentifierAndKeepsTheValues(): void
    {
        $store = new NativeSession(false);
        $store->set('a', 1);
        $old = session_id();

        $store->renew();

        self::assertNotSame($old, session_id());
        self::assertSame(1, $store->get('a'));
    }
}
