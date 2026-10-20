<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Csrf;
use Polyspec\Hyper\Tests\Support\Json;

/** HY-24: the cases of contracts/csrf.json, which the Node server passes as well. */
final class CsrfTest extends TestCase
{
    /** @return list<array<array-key, mixed>> */
    private static function fixture(string $part): array
    {
        return Json::arrays(Json::file(__DIR__ . '/../../../../contracts/csrf.json')[$part] ?? null);
    }

    /** @return iterable<string, array{string, string, string}> */
    public static function maskCases(): iterable
    {
        foreach (self::fixture('mask') as $case) {
            yield Json::string($case['id'] ?? null) => [
                Json::string($case['token'] ?? null),
                Json::string($case['mask'] ?? null),
                Json::string($case['value'] ?? null),
            ];
        }
    }

    /** @return iterable<string, array{string, string, bool}> */
    public static function verifyCases(): iterable
    {
        foreach (self::fixture('verify') as $case) {
            yield Json::string($case['id'] ?? null) => [
                Json::string($case['token'] ?? null),
                Json::string($case['value'] ?? null),
                $case['valid'] === true,
            ];
        }
    }

    #[DataProvider('maskCases')]
    public function testMasksTheTokenWithAMask(string $token, string $mask, string $value): void
    {
        self::assertSame($value, Csrf::mask($token, $mask));
    }

    #[DataProvider('verifyCases')]
    public function testVerifiesAFormValue(string $token, string $value, bool $valid): void
    {
        self::assertSame($valid, Csrf::verify($token, $value));
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
