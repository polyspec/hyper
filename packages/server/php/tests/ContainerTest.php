<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Container;

/** The services of the handlers are created once, on their first use, as the Node and Python servers create them (HY-62). */
final class ContainerTest extends TestCase
{
    public function testCreatesAServiceOnceOnItsFirstUse(): void
    {
        $created = 0;
        $container = new Container();
        $container->bind(\stdClass::class, function () use (&$created): \stdClass {
            $created++;

            return new \stdClass();
        });
        $first = $container->call(static fn (\stdClass $service): \stdClass => $service, []);
        $second = $container->call(static fn (\stdClass $service): \stdClass => $service, []);
        self::assertSame($first, $second);
        self::assertSame(1, $created);
    }
}
