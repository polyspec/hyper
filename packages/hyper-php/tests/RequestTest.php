<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\NativeSession;
use Polyspec\Hyper\Request;

final class RequestTest extends TestCase
{
    private const FORM = ['Content-Type' => 'application/x-www-form-urlencoded'];

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

    /** HY-45, HY-52: the session cookie options; the session adds no caching header. */
    public function testSessionCookieOptions(): void
    {
        self::assertSame(
            ['cookie_httponly' => true, 'cookie_samesite' => 'Lax', 'cookie_secure' => false, 'use_strict_mode' => true, 'use_only_cookies' => true, 'cache_limiter' => ''],
            NativeSession::options(false),
        );
        self::assertTrue(NativeSession::options(true)['cookie_secure']);
    }

    public function testInvalidUtf8KeysAreRejectedAtAnyDepth(): void
    {
        // HY-42
        self::assertFalse((new Request('GET', '/', [], 'a[%FF][x]=1'))->validInput());
        self::assertFalse((new Request('GET', '/', [], 'a%FF[x]=1'))->validInput());
        self::assertFalse((new Request('POST', '/', self::FORM, '', 'a[b][%C3]=v'))->validInput());
        self::assertFalse((new Request('POST', '/', self::FORM, '', 'a=%E2%82'))->validInput());
        self::assertTrue((new Request('GET', '/', [], 'a[b][c]=d'))->validInput());
    }

    /** HY-56: every query value in order, without nesting, and the raw query of the request target. */
    public function testQueryValuesAreReadInOrderWithoutNesting(): void
    {
        $server = $_SERVER;
        $get = $_GET;
        $_SERVER['REQUEST_URI'] = '/board?b=1&roles[]=a&roles%5B%5D=b&1=x&b=2&q=a+b#top';
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_GET = ['ignored' => '1'];
        try {
            $request = Request::fromGlobals();
        } finally {
            $_SERVER = $server;
            $_GET = $get;
        }
        self::assertSame('b=1&roles[]=a&roles%5B%5D=b&1=x&b=2&q=a+b', $request->rawQuery());
        $query = [];
        foreach ($request->query() as $name => $values) {
            $query[] = [$name, $values];
        }
        self::assertSame([['b', ['1', '2']], ['roles[]', ['a', 'b']], ['1', ['x']], ['q', ['a b']]], $query);
        self::assertSame(2, $request->queryInt('b', 7));
        self::assertSame('', (new Request('GET', '/'))->rawQuery());
        self::assertSame([], (new Request('GET', '/'))->query()->names());
    }

    /** HY-57: every form value of the body in order, without nesting, whatever PHP put into $_POST. */
    public function testFormValuesAreReadFromTheBodyInOrderWithoutNesting(): void
    {
        $request = new Request('POST', '/', self::FORM, '', 'title=%ED%95%9C+%EA%B8%80&roles[]=a&empty&roles%5B%5D=b&x=1&x=2');
        $form = [];
        foreach ($request->form() as $name => $values) {
            $form[] = [$name, $values];
        }
        self::assertSame([['title', ['한 글']], ['roles[]', ['a', 'b']], ['empty', ['']], ['x', ['1', '2']]], $form);
        self::assertSame('2', $request->formString('x'));
        self::assertSame('', $request->formString('missing'));
        self::assertSame([], (new Request('POST', '/', ['Content-Type' => 'text/plain'], '', 'a=1'))->form()->names());

        $server = $_SERVER;
        $post = $_POST;
        $_SERVER['REQUEST_URI'] = '/';
        $_SERVER['REQUEST_METHOD'] = 'POST';
        $_SERVER['CONTENT_TYPE'] = 'application/x-www-form-urlencoded';
        $_POST = ['ignored' => '1'];
        try {
            self::assertSame([], Request::fromGlobals()->form()->names());
        } finally {
            $_SERVER = $server;
            $_POST = $post;
        }
    }

    public function testCookiesAreNotChecked(): void
    {
        // HY-42: an invalid hy-keep is ignored and an invalid session cookie starts a new session.
        self::assertTrue((new Request('GET', '/', cookies: ['hy-keep' => "\xFF", session_name() => "\xFF"]))->validInput());
    }
}
