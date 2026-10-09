<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Result;

/** HY-46: a redirect location is an application path. */
final class ResultTest extends TestCase
{
    /** @return iterable<string, array{string}> */
    public static function rejected(): iterable
    {
        foreach (['', 'board', '//evil.example', '/\\evil.example', "/\t/evil.example", "/ok\r\nX-Injected: 1", '/a b', "/a\x00", "/a\u{85}", "/a\xFF", '/a\\b', '/.//evil.example', '/a/..//evil.example', '/%2E//evil.example', '/a/%2e%2E/b', '/a/.', '/./b?x=1'] as $location) {
            yield bin2hex($location) => [$location];
        }
    }

    #[DataProvider('rejected')]
    public function testRejectsLocationsOutsideTheApplication(string $location): void
    {
        $this->expectException(\InvalidArgumentException::class);
        Result::redirect($location);
    }

    public function testAcceptsApplicationPaths(): void
    {
        self::assertSame('/board?page=2', Result::redirect('/board?page=2')->location);
        self::assertSame('/', Result::redirect('/')->location);
        self::assertSame('/a.b/..c/.d?x=..', Result::redirect('/a.b/..c/.d?x=..')->location);
    }
}
