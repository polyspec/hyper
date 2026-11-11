<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Csrf;

/** HY-24: a new mask for every form value. The cases of contracts/csrf.json are run by the case runner. */
final class CsrfTest extends TestCase
{
    public function testDrawsANewMaskForEveryValue(): void
    {
        $token = bin2hex(random_bytes(32));
        $a = Csrf::masked($token);
        $b = Csrf::masked($token);

        self::assertNotSame($a, $b);
        self::assertTrue(Csrf::verify($token, $a));
        self::assertTrue(Csrf::verify($token, $b));
    }
}
