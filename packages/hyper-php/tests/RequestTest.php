<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\NativeSession;
use Polyspec\Hyper\Request;

final class RequestTest extends TestCase
{
    /** @return iterable<string, array{string, string}> */
    public static function targets(): iterable
    {
        yield 'colon' => ['/board/12:30', '/board/12:30'];
        yield 'colon and query' => ['/t/x:0/y?x=1', '/t/x:0/y'];
        yield 'double slash' => ['//board/1', '//board/1'];
        yield 'fragment' => ['/board#top', '/board'];
        yield 'root' => ['/', '/'];
        yield 'encoded' => ['/board/%ED%95%9C?q=1', '/board/%ED%95%9C'];
        yield 'leading question mark' => ['?/board', '/'];
        yield 'absolute form' => ['http://example.test/board/1?x=1', '/board/1'];
        yield 'absolute form without path' => ['https://example.test', '/'];
    }

    /** HY-42: the request path is the request target up to `?` or `#`, without further parsing. */
    #[DataProvider('targets')]
    public function testPathIsTheRequestTargetBeforeTheQuery(string $target, string $path): void
    {
        $server = $_SERVER;
        $_SERVER['REQUEST_URI'] = $target;
        $_SERVER['REQUEST_METHOD'] = 'GET';
        try {
            self::assertSame($path, Request::fromGlobals()->path);
        } finally {
            $_SERVER = $server;
        }
    }

    /** HY-45: the session cookie options. */
    public function testSessionCookieOptions(): void
    {
        self::assertSame(
            ['cookie_httponly' => true, 'cookie_samesite' => 'Lax', 'cookie_secure' => false, 'use_strict_mode' => true, 'use_only_cookies' => true],
            NativeSession::options(false),
        );
        self::assertTrue(NativeSession::options(true)['cookie_secure']);
    }
}
