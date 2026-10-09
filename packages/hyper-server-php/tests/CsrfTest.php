<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Csrf;
use Polyspec\Hyper\Tests\Support\Json;

/** HY-24: the cases of conformance/csrf.json, which the Node server passes as well. */
final class CsrfTest extends TestCase
{
    /** @return list<array<array-key, mixed>> */
    private static function fixture(string $part): array
    {
        return Json::arrays(Json::file(__DIR__ . '/../../../conformance/csrf.json')[$part] ?? null);
    }

    public function testMasksTheTokenWithAMask(): void
    {
        foreach (self::fixture('mask') as $case) {
            self::assertSame($case['value'] ?? null, Csrf::mask(Json::string($case['token'] ?? null), Json::string($case['mask'] ?? null)), Json::string($case['label'] ?? null));
        }
    }

    public function testVerifiesAFormValue(): void
    {
        foreach (self::fixture('verify') as $case) {
            self::assertSame($case['valid'] ?? null, Csrf::verify(Json::string($case['token'] ?? null), Json::string($case['value'] ?? null)), Json::string($case['label'] ?? null));
        }
    }

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
