<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\App;
use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\ClientRendering;
use Polyspec\Hyper\Csrf;
use Polyspec\Hyper\Reply;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Response;
use Polyspec\Hyper\Result;
use Polyspec\Hyper\Tests\Support\Counter;
use Polyspec\Hyper\Tests\Support\Json;

/**
 * HY-62: one server answers the client-rendered and the server-rendered pages of the fixture manifest.
 *
 * @phpstan-type Options array{frameAncestors?: string, onResponse?: \Closure}
 */
final class ClientTest extends TestCase
{
    private const PROGRAM = __DIR__ . '/build/server';
    private const SHELL = __DIR__ . '/fixtures/shell/index.html';
    // A session token of HY-24; the form carries a masked value of it.
    private const TOKEN = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

    /** @return array<array-key, mixed> */
    private static function conformance(): array
    {
        return Json::file(__DIR__ . '/../../../conformance/client.json');
    }

    /**
     * @param Options $options further named arguments of App::open
     */
    private static function app(Counter $counter, ?ClientRendering $client = null, array $options = []): App
    {
        $client ??= new ClientRendering(self::SHELL, Json::string(self::conformance()['basePath'] ?? null), fn (Request $request): bool => $request->header('Host') === self::conformance()['chosenHost']);
        $app = App::open(...[
            'manifest' => __DIR__ . '/fixtures/app.json',
            'program' => self::PROGRAM,
            'handlers' => [
                'regions' => ['side' => fn (Counter $counter): array => ['count' => $counter->count, 'note' => null]],
                'routes' => [
                    'home' => ['load' => fn (Counter $counter): array => ['name' => "n{$counter->count}"]],
                    'add' => ['post' => function (Request $request, Counter $counter): Result {
                        $counter->actions++;
                        if ($request->formString('name') === 'taken') {
                            return Result::page(409, ['name' => 'taken', 'error' => 'conflict']);
                        }
                        $counter->count++;

                        return Result::redirect('/');
                    }],
                    'list' => ['regions' => ['rows' => fn (): array => ['items' => [], 'open' => false, 'mode' => 'a', 'view' => 'x', 'filter' => ['a' => 1], 'tags' => []]]],
                    'item' => ['load' => fn (Request $request): array => ['id' => $request->param('id')]],
                ],
            ],
            'timezone' => '+09:00',
            'clientRendering' => $client,
            ...$options,
        ]);
        $app->bind(Counter::class, fn (): Counter => $counter);

        return $app;
    }

    /** @return iterable<string, array{array<array-key, mixed>}> */
    public static function cases(): iterable
    {
        foreach (Json::arrays(self::conformance()['cases'] ?? null) as $case) {
            yield Json::string($case['label'] ?? null) => [$case];
        }
    }

    /** @param array<array-key, mixed> $case */
    #[DataProvider('cases')]
    public function testConformance(array $case): void
    {
        $counter = new Counter();
        $session = new ArraySession();
        $request = Json::array($case['request'] ?? null);
        $form = isset($request['form']) ? Json::stringMap($request['form']) : null;
        if ($request['csrf'] ?? false) {
            $session->set('_hyper_csrf', self::TOKEN);
            $form = ['_csrf' => Csrf::masked(self::TOKEN), ...$form ?? []];
        }
        $headers = Json::stringMap($request['headers'] ?? null);
        if ($form !== null) {
            $headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }
        $target = Json::string($request['target'] ?? null);
        $question = strpos($target, '?');
        $query = $question === false ? '' : substr($target, $question + 1);
        $path = $question === false ? $target : substr($target, 0, $question);
        $response = self::app($counter)->handle(new Request(Json::string($request['method'] ?? null), $path, $headers, $query, $form === null ? '' : http_build_query($form)), $session);

        self::assertSame($case['status'] ?? null, $response->status);
        foreach (Json::stringMap($case['headers'] ?? null) as $name => $value) {
            self::assertSame($value, $response->headers[$name] ?? null, $name);
        }
        if ($case['shell'] ?? false) {
            self::assertSame((string) file_get_contents(self::SHELL), $response->body);
            self::assertSame($case['headers'], $response->headers);
        }
        if (array_key_exists('body', $case)) {
            self::assertSame($case['body'], $response->body);
        }
        if (isset($case['json'])) {
            $expected = Json::array($case['json']);
            $json = Json::decode($response->body);
            self::assertSame($expected['route'] ?? null, $json['route'] ?? null);
            self::assertSame($expected['params'] ?? null, $json['params'] ?? null);
            self::assertSame($expected['regions'] ?? null, array_keys(Json::array($json['regions'] ?? null)));
        }
        if (($case['session'] ?? true) === false) {
            self::assertNull($session->get('_hyper_csrf'));
        }
        self::assertSame($case['actions'], $counter->actions);
    }

    public function testTheShellResponseIsReportedWithTheFramePolicyAndAnEmptyReply(): void
    {
        // HY-45, HY-60
        $reports = [];
        $app = self::app(new Counter(), null, [
            'frameAncestors' => "'self' https://frame.test",
            'onResponse' => function (Request $request, Response $response, float $elapsed, Reply $reply) use (&$reports): void {
                $reports[] = [$request->path, $response->status, $response->headers['Content-Security-Policy'] ?? null, $reply->notes()];
            },
        ]);
        $app->handle(new Request('GET', '/list', ['Host' => 'client.test']), new ArraySession());
        $app->handle(new Request('GET', '/_props/list', ['Host' => 'client.test']), new ArraySession());
        self::assertSame([
            ['/list', 200, "frame-ancestors 'self' https://frame.test", []],
            ['/_props/list', 406, "frame-ancestors 'self' https://frame.test", []],
        ], $reports);
    }

    public function testASelectionThatFailsAnswers500(): void
    {
        // HY-43, HY-62
        $logged = ini_set('error_log', '/dev/null');
        try {
            foreach ([fn (): string => 'csr', fn (): bool => throw new \RuntimeException('selection')] as $selects) {
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
        $selects = fn (): bool => true;
        $invalid = [
            'relative shell' => new ClientRendering('tests/fixtures/shell/index.html', '/_props', $selects),
            'missing shell' => new ClientRendering(__DIR__ . '/fixtures/shell/missing.html', '/_props', $selects),
            'shell of another base path' => new ClientRendering(__DIR__ . '/fixtures/shell/other-base.html', '/_props', $selects),
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
