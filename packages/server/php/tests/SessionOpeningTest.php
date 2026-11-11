<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\App;
use Polyspec\Hyper\Choice;
use Polyspec\Hyper\ClientRendering;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Response;
use Polyspec\Hyper\Result;
use Polyspec\Hyper\Tests\Support\ContextRun;
use Polyspec\Hyper\Tests\Support\CountingStore;
use Polyspec\Hyper\Tests\Support\Json;

/**
 * HY-120: the application opens the session only for a request that the checks before the session let through. Each
 * refused request makes no call of the session store and sets no cookie; a page request makes the calls that prove the
 * counting store works.
 */
final class SessionOpeningTest extends TestCase
{
    private const PROGRAM = __DIR__ . '/build/server';
    private const SHELL = __DIR__ . '/fixtures/shell/index.html';
    private const PROGRAMS = __DIR__ . '/../../../../var/contract-programs';
    private const CONTRACT = __DIR__ . '/../../../../contracts/context.json';
    // The body of the test request has eleven bytes, above this limit (HY-59).
    private const BODY_LIMIT = 4;

    public function testAnAcceptThatSelectsNoTypeOpensNoSession(): void
    {
        $store = new CountingStore();
        $response = self::app()->handle(new Request('GET', '/', ['Accept' => 'application/xml']), $store);

        self::assertSame(406, $response->status);
        self::assertRefused($store, $response);
    }

    public function testAPutOfAPageRouteOpensNoSession(): void
    {
        $store = new CountingStore();
        $response = self::app()->handle(new Request('PUT', '/', ['Accept' => 'text/html']), $store);

        self::assertSame(405, $response->status);
        self::assertRefused($store, $response);
    }

    public function testAnInvalidHyperContextOpensNoSession(): void
    {
        $run = new ContextRun('with_context', self::contextApplication(), self::PROGRAMS);
        $app = $run->open(null);
        $store = new CountingStore();
        $response = $app->handle(
            new Request('GET', '/', ['Accept' => 'text/html', 'Hyper-Context' => 'xyz']),
            $store,
        );

        self::assertSame(400, $response->status);
        self::assertRefused($store, $response);
    }

    public function testABodyAboveTheLimitOpensNoSession(): void
    {
        $store = new CountingStore();
        $response = self::app(bodyLimit: self::BODY_LIMIT)->handle(
            new Request(
                'POST',
                '/',
                ['Accept' => 'text/html', 'Content-Type' => 'application/x-www-form-urlencoded'],
                '',
                'name=abcdef',
            ),
            $store,
        );

        self::assertSame(413, $response->status);
        self::assertRefused($store, $response);
    }

    public function testAPageRequestUnderTheDataBasePathOpensNoSession(): void
    {
        $store = new CountingStore();
        $response = self::app(client: self::client())->handle(
            new Request('GET', '/_props/items/7', ['Accept' => 'text/html']),
            $store,
        );

        self::assertSame(406, $response->status);
        self::assertRefused($store, $response);
    }

    public function testARequestThatReceivesTheShellOpensNoSession(): void
    {
        $store = new CountingStore();
        $response = self::app(client: self::client())->handle(
            new Request('GET', '/', ['Accept' => 'text/html']),
            $store,
        );

        self::assertSame(200, $response->status);
        self::assertRefused($store, $response);
    }

    public function testAGetOfAPageWithTextHtmlOpensTheSession(): void
    {
        $store = new CountingStore();
        $response = self::app()->handle(new Request('GET', '/', ['Accept' => 'text/html']), $store);

        self::assertSame(200, $response->status);
        self::assertGreaterThan(0, $store->calls, 'the store is called for a page request');
    }

    /** Asserts that the refused request made no call of the store and set no cookie (HY-120). */
    private static function assertRefused(CountingStore $store, Response $response): void
    {
        self::assertSame(0, $store->calls, 'the store receives no call');
        self::assertArrayNotHasKey('Set-Cookie', $response->headers, 'the response sets no cookie');
    }

    private static function app(?int $bodyLimit = null, ?ClientRendering $client = null): App
    {
        return App::open(
            manifest: __DIR__ . '/fixtures/app.json',
            program: self::PROGRAM,
            handlers: [
                'regions' => ['side' => fn (): array => ['count' => 0, 'note' => null]],
                'routes' => [
                    'home' => ['load' => fn (): array => ['name' => 'n0']],
                    'item' => ['load' => fn (): array => ['id' => '7']],
                    // The route of the fixture declares a POST; no test of this file sends one.
                    'add' => ['post' => fn (): Result => Result::redirect('/')],
                ],
            ],
            timezone: '+09:00',
            bodyLimit: $bodyLimit ?? 8 * 1024 * 1024,
            clientRendering: $client,
        );
    }

    private static function client(): ClientRendering
    {
        return new ClientRendering(self::SHELL, '/_props', fn (Request $request): Choice => new Choice(true, null));
    }

    /** @return array<string, mixed> */
    private static function contextApplication(): array
    {
        $contract = Json::file(self::CONTRACT);

        return Json::array(Json::array($contract['applications'])['with_context']);
    }
}
