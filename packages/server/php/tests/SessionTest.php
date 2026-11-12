<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\Session;

/** The kept values of one visitor as another server stored them (HY-40, HY-104). */
final class SessionTest extends TestCase
{
    public function testReadsTheStdClassThatHoldsTheKeptValuesOfEveryRegion(): void
    {
        // HY-104: a map that an array would read as a list arrives as a stdClass, also the map from a region name to
        // its kept values.
        $store = new ArraySession();
        $session = new Session($store);
        $store->set('_hyper_keep', (object) ['0' => (object) ['0' => 'a', '1' => 'b']]);
        self::assertSame(['0' => 'a', '1' => 'b'], $session->kept('0'));
        $session->keep('0', 'sort', 'title');
        self::assertSame(['0' => 'a', '1' => 'b', 'sort' => 'title'], $session->kept('0'));
    }
}
