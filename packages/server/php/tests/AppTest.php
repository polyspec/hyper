<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\App;
use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\Reply;
use Polyspec\Hyper\Renderer;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Response;
use Polyspec\Hyper\Result;
use Polyspec\Hyper\Tests\Support\Counter;
use Polyspec\Hyper\Tests\Support\Json;

/**
 * The page application where contracts/app.json does not state it: the renders of the renderer unit, the number of
 * bindings of a document, `around` in the process (HY-97) and two members of the report of the response hook (HY-60).
 *
 * @phpstan-type Options array{responseLimit?: int, onResponse?: \Closure, around?: \Closure}
 */
final class AppTest extends TestCase
{
    private const JSON = ['Accept' => 'application/vnd.hyper+json', 'HX-Request' => 'true'];
    // The server program of the fixtures, which `make hyper-test-php` builds (HY-48).
    private const PROGRAM = __DIR__ . '/build/server';
    private const BUILD = '1111111111111111111111111111111111111111111111111111111111111111';

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

    public function testPartsRenderedAloneMatchTheDocument(): void
    {
        // HY-13
        $renderer = Renderer::open(self::PROGRAM, '+09:00');
        $shared = $renderer->bind(['title' => 'T', 'name' => 'shared']);
        $side = $renderer->bind(['count' => 1, 'note' => 'x']);
        $content = $renderer->bind(['title' => 'region', 'name' => 'n']);
        $document = $renderer->document('layout.tpl', 'title.tpl', $shared, [
            'side' => ['template' => 'side.tpl', 'data' => $side],
            'content' => ['template' => 'page.tpl', 'data' => $content],
        ], 'content', [], $renderer->bind(['response' => new \stdClass()]), self::BUILD);

        self::assertStringContainsString(
            '<title>' . $renderer->alone('title.tpl', $shared, $renderer->bind([])) . '</title>'
                . '<meta name="hyper-build" content="' . self::BUILD . '">',
            $document,
        );
        self::assertStringContainsString(
            '<aside id="side">' . $renderer->alone('side.tpl', $shared, $side) . '</aside>',
            $document,
        );
        self::assertSame("<p>region|n</p>\n", $renderer->alone('page.tpl', $shared, $content));
        self::assertStringContainsString("<main id=\"content\"><p>region|n</p>\n</main>", $document);
    }

    public function testPageRegionAlonePassesRouteRegionsAsDefinitions(): void
    {
        // HY-13, HY-30
        $renderer = Renderer::open(self::PROGRAM, 'Z');
        $shared = $renderer->bind(['title' => 'T']);
        $rows = ['template' => 'rows.tpl', 'data' => $renderer->bind(['items' => ['x']])];
        $page = $renderer->alone('list.tpl', $shared, $renderer->bind([]), ['rows' => $rows]);
        $document = $renderer->document('layout.tpl', 'title.tpl', $shared, [
            'side' => ['template' => 'side.tpl', 'data' => $renderer->bind(['count' => 1])],
            'content' => ['template' => 'list.tpl', 'data' => $renderer->bind([])],
        ], 'content', ['rows' => $rows], $renderer->bind(['response' => new \stdClass()]), self::BUILD);

        self::assertSame("<h1>T</h1><ul id=\"rows\"><li>x</li></ul>\n", $page);
        self::assertStringContainsString('<main id="content">' . $page . '</main>', $document);
        self::assertStringContainsString(
            '<ul id="rows">' . $renderer->alone('rows.tpl', $shared, $rows['data']) . '</ul>',
            $document,
        );
    }

    public function testBindsEachRootOncePerDocument(): void
    {
        // H10.4: the HY-44 check binds the shared data once, and the document binds it once more for all of its
        // renders (title, side, content and layout), so the number of checks does not grow with the renders. A document
        // that embeds its data binds it once more in the embedded data (HY-31, HY-92). A JSON response checks only the
        // parameters again and encodes the value once.
        $title = new class () implements \JsonSerializable {
            public int $serialized = 0;

            public function jsonSerialize(): mixed
            {
                $this->serialized++;

                return 'T';
            }
        };
        $app = App::open(__DIR__ . '/fixtures/app.json', self::PROGRAM, [
            'shared' => fn (): array => ['title' => $title],
            'routes' => [
                'home' => ['load' => fn (): array => ['name' => 'n']],
                'add' => ['post' => fn (): Result => Result::redirect('/')],
                'list' => ['regions' => ['rows' => function (Request $request, Reply $reply): array {
                    if ($request->queryInt('embed', 0) === 1) {
                        $reply->embedData();
                    }

                    return ['items' => []];
                }]],
            ],
        ], 'Z');

        $document = $app->handle(new Request('GET', '/'), $this->session);
        self::assertSame(200, $document->status);
        self::assertStringContainsString('<title>T - Site</title>', $document->body);
        self::assertSame(2, $title->serialized);

        $title->serialized = 0;
        self::assertSame(200, $app->handle(new Request('GET', '/', self::JSON), $this->session)->status);
        self::assertSame(2, $title->serialized);

        $title->serialized = 0;
        self::assertSame(200, $app->handle(new Request('GET', '/list'), $this->session)->status);
        self::assertSame(2, $title->serialized);

        $title->serialized = 0;
        self::assertSame(200, $app->handle(new Request('GET', '/list', [], 'embed=1'), $this->session)->status);
        self::assertSame(3, $title->serialized);
    }

    public function testTheElapsedTimeOfAGivenStartIsNotTheTimeOfAnotherClock(): void
    {
        // HY-60: the elapsed time counts on the monotonic clock from the hrtime(true) start that the caller gives, so a
        // start of two seconds ago gives no time of another clock, such as the milliseconds of the wall clock.
        $elapsed = [];
        $app = $this->app(['onResponse' => function (Request $request, Response $response, float $time) use (&$elapsed): void {
            $elapsed[] = $time;
        }]);
        $app->handle(new Request('GET', '/'), $this->session, hrtime(true) - 2_000_000_000);

        self::assertCount(1, $elapsed);
        self::assertLessThan(60000.0, $elapsed[0]);
    }

    public function testTheFailureOfAResponseOverTheLimitIsTheLogLineWithoutItsPrefix(): void
    {
        // HY-60, HY-66: the hook receives the failure that the server logs, and nothing before or after it.
        $reports = [];
        $app = $this->app(['responseLimit' => 64, 'onResponse' => self::reportTo($reports)]);
        $app->handle(new Request('GET', '/'), $this->session);

        self::assertCount(1, $reports);
        self::assertIsString($reports[0][2]);
        self::assertMatchesRegularExpression(
            '/^the response to GET \/ has \d+ bytes, more than the response limit of 64 bytes$/D',
            $reports[0][2],
        );
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
