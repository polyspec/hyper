<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Csrf;

/** HY-24: the cases of conformance/csrf.json, which the Node server passes as well. */
final class CsrfTest extends TestCase
{
    /** @return array<string, list<array<string, mixed>>> */
    private static function fixture(): array
    {
        return json_decode((string) file_get_contents(__DIR__ . '/../../../conformance/csrf.json'), true, flags: JSON_THROW_ON_ERROR);
    }

    public function testMasksTheTokenWithAMask(): void
    {
        foreach (self::fixture()['mask'] as $case) {
            self::assertSame($case['value'], Csrf::mask($case['token'], $case['mask']), $case['label']);
        }
    }

    public function testVerifiesAFormValue(): void
    {
        foreach (self::fixture()['verify'] as $case) {
            self::assertSame($case['valid'], Csrf::verify($case['token'], $case['value']), $case['label']);
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
