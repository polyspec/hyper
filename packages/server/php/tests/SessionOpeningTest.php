<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Response;
use Polyspec\Hyper\Tests\Support\ContextRun;
use Polyspec\Hyper\Tests\Support\CountingStore;
use Polyspec\Hyper\Tests\Support\Json;

/**
 * HY-120, HY-127: a request whose Hyper-Context header is not valid is refused before the session: it makes no call of
 * the session store and sets no cookie.
 */
final class SessionOpeningTest extends TestCase
{
    private const PROGRAMS = __DIR__ . '/../../../../var/contract-programs';
    private const CONTRACT = __DIR__ . '/../../../../contracts/context.json';

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

    /** Asserts that the refused request made no call of the store and set no cookie (HY-120). */
    private static function assertRefused(CountingStore $store, Response $response): void
    {
        self::assertSame(0, $store->calls, 'the store receives no call');
        self::assertArrayNotHasKey('Set-Cookie', $response->headers, 'the response sets no cookie');
    }

    /** @return array<string, mixed> */
    private static function contextApplication(): array
    {
        $contract = Json::file(self::CONTRACT);

        return Json::array(Json::array($contract['applications'])['with_context']);
    }
}
