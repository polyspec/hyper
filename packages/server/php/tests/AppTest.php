<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\App;
use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\Reply;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Response;
use Polyspec\Hyper\Result;
use Polyspec\Hyper\Tests\Support\Counter;
use Polyspec\Hyper\Tests\Support\Json;

/**
 * `around` in the process (HY-97), where contracts/app.json does not state it.
 *
 * @phpstan-type Options array{onResponse?: \Closure, around?: \Closure}
 */
final class AppTest extends TestCase
{
    // The server program of the fixtures, which `make hyper-test-php` builds (HY-48).
    private const PROGRAM = __DIR__ . '/build/server';

    private ArraySession $session;
    private Counter $counter;

    protected function setUp(): void
    {
        $this->session = new ArraySession();
        $this->counter = new Counter();
    }

    /** @param Options $options further named arguments of App::open */
    private function app(array $options = []): App
    {
        $counter = $this->counter;
        $app = App::open(...[
            'manifest' => __DIR__ . '/fixtures/app.json',
            'program' => self::PROGRAM,
            'handlers' => [
                'regions' => [
                    'side' => fn (Counter $counter): array => ['count' => $counter->count, 'note' => null],
                ],
                'routes' => [
                    'home' => ['load' => fn (Counter $counter): array => ['name' => "n{$counter->count}"]],
                    'add' => ['post' => function (Counter $counter): Result {
                        $counter->actions++;

                        return Result::redirect('/');
                    }],
                    'item' => ['load' => fn (Request $request): array => ['id' => $request->param('id')]],
                ],
            ],
            'timezone' => '+09:00',
            ...$options,
        ]);
        $app->bind(Counter::class, fn (): Counter => $counter);

        return $app;
    }

    /** @return array<array-key, mixed> */
    private static function json(Response $response): array
    {
        return Json::decode($response->body);
    }

    /**
     * The response hook that appends the status, the notes of the reply and the failure of each response to `$reports`.
     *
     * @param list<array{int, array<string, mixed>, ?string}> $reports
     */
    private static function reportTo(array &$reports): \Closure
    {
        return function (
            Request $request,
            Response $response,
            float $elapsed,
            Reply $reply,
            ?string $failure,
        ) use (&$reports): void {
            $reports[] = [$response->status, array_column($reply->notes(), 1, 0), $failure];
        };
    }

    public function testAroundAnswersTheRequestThatItPassesAndSendsItsResponse(): void
    {
        // HY-97: around receives the request and `answer`, which runs the application for a request or a changed copy.
        $calls = [];
        $around = function (Request $request, \Closure $answer) use (&$calls): Response {
            $calls[] = $request->method . ' ' . $request->path();

            $answered = $answer($request->withHeader('Accept', 'application/vnd.hyper+json'));
            self::assertInstanceOf(Response::class, $answered);

            return $answered->withHeader('X-Around', 'yes');
        };
        $response = $this->app(['around' => $around])->handle(new Request('GET', '/items/7'), $this->session);

        self::assertSame(200, $response->status);
        self::assertSame('yes', $response->headers['X-Around']);
        self::assertSame('application/vnd.hyper+json', $response->headers['Content-Type']);
        self::assertSame('item', self::json($response)['route']);
        self::assertSame(['GET /items/7'], $calls);
    }

    public function testAroundAloneRunsNoLoaderActionOrHook(): void
    {
        // HY-97: without a call of `answer` the session stays untouched and no hook of the application runs.
        $reports = [];
        $app = $this->app([
            'around' => fn (): Response => Response::text(418, 'alone'),
            'onResponse' => self::reportTo($reports),
        ]);
        $response = $app->handle(new Request('GET', '/'), $this->session);

        self::assertSame(418, $response->status);
        self::assertSame('alone', $response->body);
        self::assertNull($this->session->get('_hyper_csrf'));
        self::assertSame([], $reports);
        self::assertSame(0, $this->counter->actions);
    }

    public function testAnErrorOfAroundAndAValueThatIsNoResponseEscape(): void
    {
        // HY-97, HY-60: they are not answered by the application (HY-43); App::run writes the plain 500 for them.
        $throws = $this->app(['around' => function (): Response {
            throw new \RuntimeException('around boom');
        }]);
        try {
            $throws->handle(new Request('GET', '/'), $this->session);
            self::fail('the error of around was answered');
        } catch (\RuntimeException $error) {
            self::assertSame('around boom', $error->getMessage());
        }
        $returns = $this->app(['around' => fn (): string => 'not a response']);
        $this->expectException(\UnexpectedValueException::class);
        $returns->handle(new Request('GET', '/'), $this->session);
    }
}
