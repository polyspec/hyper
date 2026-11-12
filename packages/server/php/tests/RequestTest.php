<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Server\NativeSession;
use Polyspec\Hyper\Server\Request;

final class RequestTest extends TestCase
{
    /** HY-100.31: the host passes the method in upper case. */
    public function testTheMethodOfTheSapiIsReadInUpperCase(): void
    {
        $server = $_SERVER;
        $_SERVER['REQUEST_URI'] = '/';
        $_SERVER['REQUEST_METHOD'] = 'purge';
        try {
            self::assertSame('PURGE', Request::fromGlobals()->method);
        } finally {
            $_SERVER = $server;
        }
    }

    /** HY-45, HY-52: the session cookie options; the session adds no caching header. */
    public function testSessionCookieOptions(): void
    {
        self::assertSame(
            [
                'name' => 'hy-session',
                'cookie_path' => '/',
                'cookie_domain' => '',
                'cookie_httponly' => true,
                'cookie_samesite' => 'Lax',
                'cookie_secure' => false,
                'use_strict_mode' => true,
                'use_only_cookies' => true,
                'use_cookies' => false,
                'cache_limiter' => '',
                'serialize_handler' => 'php_serialize',
            ],
            NativeSession::options(false),
        );
        self::assertTrue(NativeSession::options(true)['cookie_secure']);
        self::assertSame('__Host-hy-session', NativeSession::options(true)['name']);
    }

    /** HY-42: `fromGlobals` takes the request target from `REQUEST_URI`. */
    public function testFromGlobalsTakesTheTargetFromTheRequestUri(): void
    {
        $server = $_SERVER;
        $_SERVER['REQUEST_URI'] = '/t/x:0/y?x=1';
        $_SERVER['REQUEST_METHOD'] = 'GET';
        try {
            self::assertSame('/t/x:0/y', Request::fromGlobals()->path());
        } finally {
            $_SERVER = $server;
        }
    }

    /** HY-56: `fromGlobals` reads the query from the request target, whatever PHP put into $_GET. */
    public function testFromGlobalsReadsTheQueryFromTheRequestUriAndNotFromGet(): void
    {
        $server = $_SERVER;
        $get = $_GET;
        $_SERVER['REQUEST_URI'] = '/board?b=1&b=2#top';
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_GET = ['ignored' => '1'];
        try {
            $request = Request::fromGlobals();
        } finally {
            $_SERVER = $server;
            $_GET = $get;
        }
        self::assertSame('b=1&b=2', $request->rawQuery());
        self::assertSame([['b', ['1', '2']]], $request->query());
    }

    /** HY-57.6: `fromGlobals` reads the form values from the body, whatever PHP put into $_POST. */
    public function testFromGlobalsReadsNoFormValueFromPost(): void
    {
        $server = $_SERVER;
        $post = $_POST;
        $_SERVER['REQUEST_URI'] = '/';
        $_SERVER['REQUEST_METHOD'] = 'POST';
        $_SERVER['CONTENT_TYPE'] = 'application/x-www-form-urlencoded';
        $_POST = ['ignored' => '1'];
        try {
            self::assertSame([], Request::fromGlobals()->form());
        } finally {
            $_SERVER = $server;
            $_POST = $post;
        }
    }
}
