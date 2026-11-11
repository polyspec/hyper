<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Cookies;
use Polyspec\Hyper\Tests\Support\Json;

/** HY-129: the cases of contracts/cookies.json, which the Node and Python servers pass as well. */
final class CookiesTest extends TestCase
{
    /** @return list<array<array-key, mixed>> */
    private static function cases(): array
    {
        return Json::arrays(Json::file(__DIR__ . '/../../../../contracts/cookies.json')['parse'] ?? null);
    }

    /** @return iterable<string, array{?string, array<array-key, string>}> */
    public static function parseCases(): iterable
    {
        foreach (self::cases() as $case) {
            $header = $case['header'] ?? null;
            // The header of a case is text whose characters U+0000 to U+00FF are its bytes (HY-129).
            $bytes = is_string($header) ? mb_convert_encoding($header, 'ISO-8859-1', 'UTF-8') : null;
            // A decimal name stays an integer key, as PHP gives it, so the keys are kept as they are.
            $expected = [];
            foreach (Json::array($case['cookies'] ?? null) as $name => $value) {
                $expected[$name] = Json::string($value);
            }
            yield Json::string($case['id'] ?? null) => [$bytes, $expected];
        }
    }

    public function testTheFileHoldsCases(): void
    {
        self::assertNotEmpty(self::cases(), 'contracts/cookies.json holds no case of parse');
    }

    /** @param array<array-key, string> $expected */
    #[DataProvider('parseCases')]
    public function testParsesTheCookiesOfAHeader(?string $header, array $expected): void
    {
        $actual = Cookies::parse($header);
        // The cookies are a map from names to values, so the order of the pairs does not count.
        ksort($actual);
        ksort($expected);

        self::assertSame($expected, $actual);
    }
}
