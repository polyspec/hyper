<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\App;
use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\Choice;
use Polyspec\Hyper\ClientRendering;
use Polyspec\Hyper\Csrf;
use Polyspec\Hyper\Reply;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Response;
use Polyspec\Hyper\Result;
use Polyspec\Hyper\Tests\Support\ClientApp;
use Polyspec\Hyper\Tests\Support\Counter;

/**
 * HY-62: one server answers the client-rendered and the server-rendered pages of the fixture manifest.
 *
 * @phpstan-type Options array{frameAncestors?: string, onResponse?: \Closure}
 */
final class ClientTest extends TestCase
{
    private const PROGRAM = ClientApp::PROGRAM;
    private const SHELL = ClientApp::SHELL;
    // A session token of HY-24; the form carries a masked value of it.
    private const TOKEN = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
    private const BASE_PATH = '/_props';
    private const CHOSEN_HOST = 'client.test';

    /**
     * @param Options $options further named arguments of App::open
     */
    private static function app(Counter $counter, ?ClientRendering $client = null, array $options = []): App
    {
        return ClientApp::open(self::BASE_PATH, self::CHOSEN_HOST, $counter, $client, $options);
    }

    public function testTheShellResponseIsReportedWithTheFramePolicyAndAnEmptyReply(): void
    {
        // HY-45, HY-60
        $reports = [];
        $app = self::app(new Counter(), null, [
            'frameAncestors' => "'self' https://frame.test",
            'onResponse' => function (
                Request $request,
                Response $response,
                float $elapsed,
                Reply $reply,
            ) use (&$reports): void {
                $reports[] = [
                    $request->path(),
                    $response->status,
                    $response->headers['Content-Security-Policy'] ?? null,
                    array_column($reply->notes(), 1, 0),
                ];
            },
        ]);
        $app->handle(new Request('GET', '/list', ['Host' => 'client.test']), new ArraySession());
        $app->handle(new Request('GET', '/_props/list', ['Host' => 'client.test']), new ArraySession());
        self::assertSame([
            ['/list', 200, "frame-ancestors 'self' https://frame.test", []],
            ['/_props/list', 406, "frame-ancestors 'self' https://frame.test", []],
        ], $reports);
    }

    public function testEveryHandlerOfARequestReadsTheValueOfTheChoice(): void
    {
        // HY-62: the selection runs once per request, and its value reaches the shared handler, the loaders and the
        // action of the request, whether the selection chose the request or not.
        $selections = 0;
        $seen = [];
        $choose = function (Request $request) use (&$selections): Choice {
            $selections++;
            $host = (string) $request->header('Host');

            return new Choice($host === 'client.test', ['host' => $host]);
        };
        $app = App::open(
            manifest: __DIR__ . '/fixtures/app.json',
            program: self::PROGRAM,
            handlers: [
                'shared' => function (Request $request) use (&$seen): array {
                    $seen[] = ['shared', $request->selection()];

                    return [];
                },
                'regions' => ['side' => function (Request $request) use (&$seen): array {
                    $seen[] = ['side', $request->selection()];

                    return ['count' => 0, 'note' => null];
                }],
                'routes' => [
                    'item' => ['load' => function (Request $request) use (&$seen): array {
                        $seen[] = ['item', $request->selection()];

                        return ['id' => $request->param('id')];
                    }],
                    'add' => ['post' => function (Request $request) use (&$seen): Result {
                        $seen[] = ['add', $request->selection()];

                        return Result::redirect('/');
                    }],
                ],
            ],
            timezone: '+09:00',
            clientRendering: new ClientRendering(self::SHELL, '/_props', $choose),
        );
        $app->handle(new Request('GET', '/items/7', ['Host' => 'server.test']), new ArraySession());
        self::assertSame(1, $selections);
        self::assertSame(
            [
                ['shared', ['host' => 'server.test']],
                ['side', ['host' => 'server.test']],
                ['item', ['host' => 'server.test']],
            ],
            $seen,
        );
        $seen = [];
        $app->handle(
            new Request('GET', '/_props/items/7', ['Host' => 'client.test', 'Accept' => 'application/vnd.hyper+json']),
            new ArraySession(),
        );
        self::assertSame(2, $selections);
        self::assertSame(
            [
                ['shared', ['host' => 'client.test']],
                ['side', ['host' => 'client.test']],
                ['item', ['host' => 'client.test']],
            ],
            $seen,
        );
        $seen = [];
        $session = new ArraySession();
        $session->set('_hyper_csrf', self::TOKEN);
        $form = http_build_query(['_csrf' => Csrf::masked(self::TOKEN), 'name' => 'x']);
        $response = $app->handle(
            new Request(
                'POST',
                '/add',
                ['Host' => 'server.test', 'Content-Type' => 'application/x-www-form-urlencoded'],
                '',
                $form,
            ),
            $session,
        );
        self::assertSame(303, $response->status);
        self::assertSame(3, $selections);
        self::assertSame([['add', ['host' => 'server.test']]], $seen);
    }

    public function testARequestOfAnApplicationWithoutTheDeclarationHasTheValueNull(): void
    {
        // HY-62
        $seen = [];
        $app = App::open(
            manifest: __DIR__ . '/fixtures/app.json',
            program: self::PROGRAM,
            handlers: ['routes' => [
                'item' => ['load' => function (Request $request) use (&$seen): array {
                    $seen[] = $request->selection();

                    return ['id' => $request->param('id')];
                }],
                'add' => ['post' => fn (): Result => Result::redirect('/')],
            ]],
            timezone: '+09:00',
        );
        $app->handle(new Request('GET', '/items/7'), new ArraySession());
        self::assertSame([null], $seen);
    }

    public function testASelectionThatFailsAnswers500(): void
    {
        // HY-43, HY-62
        $logged = ini_set('error_log', '/dev/null');
        try {
            $selectors = [
                fn (): string => 'csr',
                fn (): bool => true,
                fn (): Choice => throw new \RuntimeException('selection'),
            ];
            foreach ($selectors as $selects) {
                $app = self::app(new Counter(), new ClientRendering(self::SHELL, '/_props', $selects));
                $response = $app->handle(new Request('GET', '/'), new ArraySession());
                self::assertSame(500, $response->status);
                self::assertSame('Internal Server Error', $response->body);
            }
        } finally {
            ini_set('error_log', (string) $logged);
        }
    }

    public function testAnInvalidDeclarationFailsWhenTheApplicationOpens(): void
    {
        // HY-62
        $selects = fn (): Choice => new Choice(true, null);
        $invalid = [
            'relative shell' => new ClientRendering('tests/fixtures/shell/index.html', '/_props', $selects),
            'missing shell' => new ClientRendering(__DIR__ . '/fixtures/shell/missing.html', '/_props', $selects),
            'shell of another base path' => new ClientRendering(
                __DIR__ . '/fixtures/shell/other-base.html',
                '/_props',
                $selects,
            ),
            'empty base path' => new ClientRendering(self::SHELL, '', $selects),
            'base path ending with /' => new ClientRendering(self::SHELL, '/_props/', $selects),
            'route under the base path' => new ClientRendering(self::SHELL, '/items', $selects),
        ];
        foreach ($invalid as $label => $client) {
            try {
                self::app(new Counter(), $client);
                self::fail("accepted {$label}");
            } catch (\InvalidArgumentException) {
                self::addToAssertionCount(1);
            }
        }
    }
}
