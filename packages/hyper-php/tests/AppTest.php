<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\App;
use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\NotFound;
use Polyspec\Hyper\Renderer;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Response;
use Polyspec\Hyper\Result;
use Polyspec\Hyper\Tests\Support\Counter;

final class AppTest extends TestCase
{
    private const JSON = ['Accept' => 'application/json', 'Hy-Region' => 'content'];

    private ArraySession $session;
    private Counter $counter;

    protected function setUp(): void
    {
        $this->session = new ArraySession();
        $this->counter = new Counter();
    }

    private function app(string $basePath = ''): App
    {
        $counter = $this->counter;
        $app = App::open(
            manifest: __DIR__ . '/fixtures/app.json',
            templates: __DIR__ . '/fixtures/templates',
            handlers: [
                'shared' => fn (Request $request): array => ['csrf' => $request->csrfToken()],
                'regions' => [
                    'side' => fn (Request $request, Counter $counter): array => [
                        'count' => $counter->count,
                        'note' => $request->flash('note'),
                    ],
                ],
                'routes' => [
                    'home' => ['load' => fn (Counter $counter): array => ['name' => "n{$counter->count}"]],
                    'add' => ['post' => function (Request $request, Counter $counter): Result {
                        $counter->actions++;
                        if ($request->formString('name') === '') {
                            return Result::invalid(['name' => '', 'error' => 'empty']);
                        }
                        $counter->count++;

                        return Result::redirect('/')->flash('note', 'added')->changed('count');
                    }],
                    'list' => ['regions' => ['rows' => fn (Counter $counter): array => ['items' => ['a<', "b{$counter->count}"]]]],
                    'item' => ['load' => function (Request $request): array {
                        if ($request->param('id') === 'missing') {
                            throw new NotFound();
                        }

                        return ['id' => $request->param('id')];
                    }],
                ],
            ],
            timezone: '+09:00',
            basePath: $basePath,
        );
        $app->bind(Counter::class, fn (): Counter => $counter);

        return $app;
    }

    /** @param array<string, string> $headers */
    private function get(string $path, array $headers = [], string $basePath = ''): Response
    {
        return $this->app($basePath)->handle(new Request('GET', $path, $headers), $this->session);
    }

    /**
     * @param array<string, string> $form
     * @param array<string, string> $headers
     */
    private function post(string $path, array $form, array $headers = [], string $basePath = ''): Response
    {
        return $this->app($basePath)->handle(new Request('POST', $path, $headers, [], $form), $this->session);
    }

    private function token(): string
    {
        $this->get('/');

        return (string) $this->session->get('_hyper_csrf');
    }

    /** @return array<string, mixed> */
    private static function json(Response $response): array
    {
        return json_decode($response->body, true, flags: JSON_THROW_ON_ERROR);
    }

    public function testHtmlRequestRendersTheDocument(): void
    {
        // HY-12, HY-15
        $response = $this->get('/');

        self::assertSame(200, $response->status);
        self::assertSame('text/html; charset=utf-8', $response->headers['Content-Type']);
        $token = (string) $this->session->get('_hyper_csrf');
        $data = '{"env":{"timezone":"+09:00"},"route":"home","params":{},"shared":{"title":"Home","csrf":"' . $token . '"},'
            . '"regions":{"side":{"count":0,"note":null},"content":{"name":"n0"}}}';
        self::assertSame(
            "<title>Home - Site</title>\n<aside id=\"side\" hy-region><b>0</b>\n</aside>\n<main id=\"content\" hy-region><p>Home|n0</p>\n</main>\n"
            . "<script type=\"application/json\" id=\"hy-data\">{$data}</script>",
            $response->body,
        );
    }

    public function testPartsRenderedAloneMatchTheDocument(): void
    {
        // HY-13
        $renderer = new Renderer(__DIR__ . '/fixtures/templates', '+09:00');
        $shared = ['title' => 'T', 'name' => 'shared'];
        $document = $renderer->document('layout.tpl', 'title.tpl', $shared, [
            'side' => ['template' => 'side.tpl', 'data' => ['count' => 1, 'note' => 'x']],
            'content' => ['template' => 'page.tpl', 'data' => ['title' => 'region', 'name' => 'n']],
        ], new \stdClass());

        self::assertStringContainsString('<title>' . $renderer->alone('title.tpl', $shared, []) . '</title>', $document);
        self::assertStringContainsString('<aside id="side" hy-region>' . $renderer->alone('side.tpl', $shared, ['count' => 1, 'note' => 'x']) . '</aside>', $document);
        self::assertSame("<p>region|n</p>\n", $renderer->alone('page.tpl', $shared, ['title' => 'region', 'name' => 'n']));
        self::assertStringContainsString("<main id=\"content\" hy-region><p>region|n</p>\n</main>", $document);
    }

    public function testDocumentEmbedsTheDocumentJson(): void
    {
        // HY-31: the embedded value equals the document JSON response of the same request.
        $html = $this->get('/list')->body;
        $json = $this->get('/list', ['Accept' => 'application/json'])->body;

        self::assertSame(1, preg_match('#<script type="application/json" id="hy-data">(.*)</script>#', $html, $found));
        self::assertSame(json_decode($json, true), json_decode($found[1], true));
        self::assertStringContainsString('"a\\u003c"', $found[1]);
    }

    public function testRouteRegionsFollowThePageRegion(): void
    {
        // HY-30
        $region = self::json($this->get('/list', self::JSON));
        $document = self::json($this->get('/list', ['Accept' => 'application/json']));

        self::assertSame(['content', 'rows'], array_keys($region['regions']));
        self::assertSame(['side', 'content', 'rows'], array_keys($document['regions']));
        self::assertSame(['items' => ['a<', 'b0']], $region['regions']['rows']);
        self::assertStringContainsString('<ul id="rows" hy-region><li>a&lt;</li><li>b0</li></ul>', $this->get('/list')->body);
    }

    public function testPageRegionAlonePassesRouteRegionsAsDefinitions(): void
    {
        // HY-13, HY-30
        $renderer = new Renderer(__DIR__ . '/fixtures/templates', 'Z');
        $shared = ['title' => 'T'];
        $rows = ['template' => 'rows.tpl', 'data' => ['items' => ['x']]];
        $page = $renderer->alone('list.tpl', $shared, [], ['rows' => $rows]);
        $document = $renderer->document('layout.tpl', 'title.tpl', $shared, [
            'side' => ['template' => 'side.tpl', 'data' => ['count' => 1]],
            'content' => ['template' => 'list.tpl', 'data' => []],
            'rows' => $rows,
        ], new \stdClass());

        self::assertSame("<h1>T</h1><ul id=\"rows\" hy-region><li>x</li></ul>\n", $page);
        self::assertStringContainsString('<main id="content" hy-region>' . $page . '</main>', $document);
        self::assertStringContainsString('<ul id="rows" hy-region>' . $renderer->alone('rows.tpl', $shared, ['items' => ['x']]) . '</ul>', $document);
    }

    public function testRouteRegionLoaderMustBeDeclared(): void
    {
        // HY-30
        $this->expectException(\InvalidArgumentException::class);
        App::open(__DIR__ . '/fixtures/app.json', __DIR__ . '/fixtures/templates', [
            'routes' => ['add' => ['post' => fn (): Result => Result::redirect('/')], 'home' => ['regions' => ['rows' => fn (): array => []]]],
        ], 'Z');
    }

    public function testRegionRequestReturnsTheProtocolShape(): void
    {
        // HY-17, HY-18
        $response = $this->get('/items/a%20b', self::JSON);

        self::assertSame(200, $response->status);
        self::assertSame('application/json; charset=utf-8', $response->headers['Content-Type']);
        $token = (string) $this->session->get('_hyper_csrf');
        self::assertSame(
            '{"env":{"timezone":"+09:00"},"route":"item","params":{"id":"a b"},"shared":{"title":"Item","csrf":"' . $token . '"},"regions":{"content":{"id":"a b"}}}',
            $response->body,
        );
    }

    public function testDocumentRequestReturnsEveryRegionInManifestOrder(): void
    {
        // HY-15, HY-18
        $json = self::json($this->get('/', ['Accept' => 'application/json']));

        self::assertSame('home', $json['route']);
        self::assertSame(['side', 'content'], array_keys($json['regions']));
    }

    public function testEmptyMapsAreJsonObjects(): void
    {
        // HY-17
        $response = $this->get('/', self::JSON);

        self::assertStringContainsString('"params":{}', $response->body);
    }

    public function testNavigationAddsRegionsThatUsePath(): void
    {
        // HY-11, HY-19
        $same = self::json($this->get('/', [...self::JSON, 'HX-Current-URL' => 'http://localhost/?page=2']));
        $other = self::json($this->get('/', [...self::JSON, 'HX-Current-URL' => 'http://localhost/add']));

        self::assertSame(['content'], array_keys($same['regions']));
        self::assertSame(['content', 'side'], array_keys($other['regions']));
        self::assertSame(['count' => 0, 'note' => null], $other['regions']['side']);
    }

    public function testRegionRequestForAnotherRegionFails(): void
    {
        // HY-16
        self::assertSame(400, $this->get('/', ['Accept' => 'application/json', 'Hy-Region' => 'side'])->status);
    }

    public function testBasePathIsRemovedForRoutingAndAddedToRedirects(): void
    {
        // HY-8, HY-11
        $routed = self::json($this->get('/api/items/7', [...self::JSON, 'HX-Current-URL' => 'http://localhost/items/7'], '/api'));
        self::assertSame(['content'], array_keys($routed['regions']));
        self::assertSame(404, $this->get('/items/7', [], '/api')->status);

        $token = $this->token();
        $redirect = $this->post('/api/add', ['_csrf' => $token, 'name' => 'a'], self::JSON, '/api');
        self::assertSame(303, $redirect->status);
        self::assertSame('/api/', $redirect->headers['Location']);
    }

    public function testActionWithoutTokenIsRejected(): void
    {
        // HY-24
        $this->token();
        $response = $this->post('/add', ['_csrf' => 'wrong', 'name' => 'a']);

        self::assertSame(403, $response->status);
        self::assertSame(0, $this->counter->actions);
    }

    public function testSuccessfulActionRedirectsAndPassesFlashAndTopicsOnce(): void
    {
        // HY-25
        $response = $this->post('/add', ['_csrf' => $this->token(), 'name' => 'a'], self::JSON);

        self::assertSame(303, $response->status);
        self::assertSame('/', $response->headers['Location']);

        $next = self::json($this->get('/', self::JSON));
        self::assertSame(['content', 'side'], array_keys($next['regions']));
        self::assertSame(['count' => 1, 'note' => 'added'], $next['regions']['side']);
        self::assertSame(['name' => 'n1'], $next['regions']['content']);

        $after = self::json($this->get('/', self::JSON));
        self::assertSame(['content'], array_keys($after['regions']));
    }

    public function testRejectedActionRendersThePageWithStatus422(): void
    {
        // HY-26
        $token = $this->token();
        $json = $this->post('/add', ['_csrf' => $token, 'name' => ''], self::JSON);
        $html = $this->post('/add', ['_csrf' => $token, 'name' => '']);

        self::assertSame(422, $json->status);
        self::assertSame(['name' => '', 'error' => 'empty'], self::json($json)['regions']['content']);
        self::assertSame(422, $html->status);
        self::assertStringContainsString('<p>Add| !empty</p>', $html->body);
        self::assertSame(0, $this->counter->count);
    }

    public function testUnknownPathsMissingResourcesAndMethodsFail(): void
    {
        // HY-27
        self::assertSame(404, $this->get('/missing')->status);
        self::assertSame(404, $this->get('/items/missing')->status);
        self::assertSame(405, $this->post('/', [])->status);
        self::assertSame(405, $this->app()->handle(new Request('DELETE', '/add'), $this->session)->status);
    }

    public function testHandlersMustMatchTheManifest(): void
    {
        // HY-2
        $this->expectException(\InvalidArgumentException::class);
        App::open(__DIR__ . '/fixtures/app.json', __DIR__ . '/fixtures/templates', ['routes' => ['unknown' => []]], 'Z');
    }

    public function testDeclaredPostRouteNeedsAnAction(): void
    {
        // HY-2
        $this->expectException(\InvalidArgumentException::class);
        App::open(__DIR__ . '/fixtures/app.json', __DIR__ . '/fixtures/templates', [], 'Z');
    }
}
