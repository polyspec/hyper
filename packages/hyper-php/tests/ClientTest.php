<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\App;
use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\ClientRendering;
use Polyspec\Hyper\Reply;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Response;
use Polyspec\Hyper\Result;
use Polyspec\Hyper\Tests\Support\Counter;

/** HY-62: one server answers the client-rendered and the server-rendered pages of the fixture manifest. */
final class ClientTest extends TestCase
{
    private const PROGRAM = __DIR__ . '/build/server';
    private const SHELL = __DIR__ . '/fixtures/shell/index.html';
    private const TOKEN = 'conformance-token';

    /** @return array<string, mixed> */
    private static function conformance(): array
    {
        return json_decode((string) file_get_contents(__DIR__ . '/../../../conformance/client.json'), true, flags: JSON_THROW_ON_ERROR);
    }

    /**
     * @param array<string, mixed> $options further named arguments of App::open
     */
    private static function app(Counter $counter, ?ClientRendering $client = null, array $options = []): App
    {
        $client ??= new ClientRendering(self::SHELL, self::conformance()['basePath'], fn (Request $request): bool => $request->header('Host') === self::conformance()['chosenHost']);
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

    /** @return iterable<string, array{array<string, mixed>}> */
    public static function cases(): iterable
    {
        foreach (self::conformance()['cases'] as $case) {
            yield $case['label'] => [$case];
        }
    }

    /** @param array<string, mixed> $case */
    #[DataProvider('cases')]
    public function testConformance(array $case): void
    {
        $counter = new Counter();
        $session = new ArraySession();
        $request = $case['request'];
        $form = $request['form'] ?? null;
        if ($case['request']['csrf'] ?? false) {
            $session->set('_hyper_csrf', self::TOKEN);
            $form = ['_csrf' => self::TOKEN, ...$form];
        }
        $headers = $request['headers'];
        if ($form !== null) {
            $headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }
        $target = $request['target'];
        $query = str_contains($target, '?') ? substr($target, strpos($target, '?') + 1) : '';
        $path = str_contains($target, '?') ? substr($target, 0, strpos($target, '?')) : $target;
        $response = self::app($counter)->handle(new Request($request['method'], $path, $headers, $query, $form === null ? '' : http_build_query($form)), $session);

        self::assertSame($case['status'], $response->status);
        foreach ($case['headers'] as $name => $value) {
            self::assertSame($value, $response->headers[$name] ?? null, $name);
        }
        if ($case['shell'] ?? false) {
            self::assertSame((string) file_get_contents(self::SHELL), $response->body);
            self::assertSame($case['headers'], $response->headers);
        }
        if (array_key_exists('body', $case)) {
            self::assertSame($case['body'], $response->body);
        }
        if ($case['document'] ?? false) {
            self::assertStringContainsString('id="hy-data"', $response->body);
        }
        if (isset($case['json'])) {
            $json = json_decode($response->body, true, flags: JSON_THROW_ON_ERROR);
            self::assertSame($case['json']['route'], $json['route']);
            self::assertSame($case['json']['params'], $json['params']);
            self::assertSame($case['json']['regions'], array_keys($json['regions']));
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
