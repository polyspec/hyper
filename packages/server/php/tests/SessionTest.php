<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\Flash;
use Polyspec\Hyper\Session;

/** The session values of one visitor (HY-24, HY-25, HY-40, HY-72): the token, the flash values and the kept values. */
final class SessionTest extends TestCase
{
    public function testTheCsrfTokenIsCreatedOnce(): void
    {
        // HY-24
        $session = new Session(new ArraySession());
        $token = $session->csrfToken();

        self::assertSame(64, strlen($token));
        self::assertSame($token, $session->csrfToken());
    }

    public function testARenewalReplacesTheToken(): void
    {
        // HY-72
        $store = new ArraySession();
        $session = new Session($store);
        $token = $session->csrfToken();
        $session->renew();

        self::assertNotSame($token, $session->csrfToken());
        self::assertSame(1, $store->renewals());
    }

    public function testFlashValuesAreTakenOnce(): void
    {
        // HY-25
        $session = new Session(new ArraySession());
        $session->putFlash(new Flash(['created' => 7], []));
        $taken = $session->takeFlash();

        self::assertSame(['created' => 7], $taken->values);
        self::assertSame([], $taken->changed);
        self::assertSame([], $session->takeFlash()->values);
    }

    public function testKeptValuesAreStoredByRegionAndPath(): void
    {
        // HY-40
        $session = new Session(new ArraySession());
        $session->keep('rows', 'open', true);
        $session->keep('rows', 'sort', 'title');

        self::assertSame(['open' => true, 'sort' => 'title'], $session->kept('rows'));
        self::assertSame([], $session->kept('reader'));
    }
}
