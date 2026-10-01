<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\App;
use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\Forbidden;
use Polyspec\Hyper\NotFound;
use Polyspec\Hyper\Redirect;
use Polyspec\Hyper\Reply;
use Polyspec\Hyper\Renderer;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Response;
use Polyspec\Hyper\Result;
use Polyspec\Hyper\Tests\Support\Counter;

final class AppTest extends TestCase
{
    private const JSON = ['Accept' => 'application/json', 'HX-Request' => 'true'];
    // The server program of the fixtures, which `make test-php` builds (HY-48).
    private const PROGRAM = __DIR__ . '/build/server';

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
            program: self::PROGRAM,
            handlers: [
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
                        if ($request->formString('name') === 'closed') {
                            throw new Forbidden();
                        }
                        if ($request->formString('name') === '') {
                            return Result::invalid(['name' => '', 'error' => 'empty']);
                        }
                        $counter->count++;

                        return Result::redirect('/')->flash('note', 'added')->changed('count');
                    }],
                    'list' => ['regions' => ['rows' => fn (Counter $counter): array => [
                        'items' => ['a<', "b{$counter->count}"],
                        'open' => false,
                        'mode' => 'a',
                        'view' => 'x',
                        'filter' => ['a' => 1],
                        'tags' => [],
                    ]]],
                    'item' => ['load' => function (Request $request, Reply $reply): array {
                        return match ($request->param('id')) {
                            'member' => (function () use ($reply): array {
                                $reply->cookie('member', 'token.1', 3600)->removeCookie('old')->cacheControl('public, max-age=60');

                                return ['id' => 'member'];
                            })(),
                            'guarded' => (function () use ($reply): array {
                                $reply->removeCookie('member');

                                throw new Forbidden();
                            })(),
                            'bad-cookie' => (function () use ($reply): array {
                                $reply->cookie('hy-keep', 'x');

                                return ['id' => 'x'];
                            })(),
                            'missing' => throw new NotFound(),
                            'private' => throw new Forbidden(),
                            'moved' => throw new Redirect(Result::redirect('/items/new')->flash('note', 'moved')),
                            'broken' => throw new \RuntimeException('secret detail /srv/app.php'),
                            'huge' => ['id' => PHP_INT_MAX],
                            'huge-float' => ['id' => 1e20],
                            'numeric' => ['5' => 'x', 'id' => 'n'],
                            default => ['id' => $request->param('id')],
                        };
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
            . '"regions":{"side":{"count":0,"note":null},"content":{"name":"n0"}},"kept":{}}';
        self::assertSame(
            "<title>Home - Site</title>\n<aside id=\"side\"><b>0</b>\n</aside>\n<main id=\"content\"><p>Home|n0</p>\n</main>\n"
            . "<script type=\"application/json\" id=\"hy-data\">{$data}</script>",
            $response->body,
        );
    }

    public function testPartsRenderedAloneMatchTheDocument(): void
    {
        // HY-13
        $renderer = Renderer::open(self::PROGRAM, '+09:00');
        $shared = ['title' => 'T', 'name' => 'shared'];
        $document = $renderer->document('layout.tpl', 'title.tpl', $shared, [
            'side' => ['template' => 'side.tpl', 'data' => ['count' => 1, 'note' => 'x']],
            'content' => ['template' => 'page.tpl', 'data' => ['title' => 'region', 'name' => 'n']],
        ], 'content', [], new \stdClass());

        self::assertStringContainsString('<title>' . $renderer->alone('title.tpl', $shared, []) . '</title>', $document);
        self::assertStringContainsString('<aside id="side">' . $renderer->alone('side.tpl', $shared, ['count' => 1, 'note' => 'x']) . '</aside>', $document);
        self::assertSame("<p>region|n</p>\n", $renderer->alone('page.tpl', $shared, ['title' => 'region', 'name' => 'n']));
        self::assertStringContainsString("<main id=\"content\"><p>region|n</p>\n</main>", $document);
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
        self::assertSame(['items' => ['a<', 'b0'], 'open' => false, 'mode' => 'a', 'view' => 'x', 'filter' => ['a' => 1], 'tags' => []], $region['regions']['rows']);
        self::assertStringContainsString('<ul id="rows"><li>a&lt;</li><li>b0</li></ul>', $this->get('/list')->body);
    }

    public function testPageRegionAlonePassesRouteRegionsAsDefinitions(): void
    {
        // HY-13, HY-30
        $renderer = Renderer::open(self::PROGRAM, 'Z');
        $shared = ['title' => 'T'];
        $rows = ['template' => 'rows.tpl', 'data' => ['items' => ['x']]];
        $page = $renderer->alone('list.tpl', $shared, [], ['rows' => $rows]);
        $document = $renderer->document('layout.tpl', 'title.tpl', $shared, [
            'side' => ['template' => 'side.tpl', 'data' => ['count' => 1]],
            'content' => ['template' => 'list.tpl', 'data' => []],
        ], 'content', ['rows' => $rows], new \stdClass());

        self::assertSame("<h1>T</h1><ul id=\"rows\"><li>x</li></ul>\n", $page);
        self::assertStringContainsString('<main id="content">' . $page . '</main>', $document);
        self::assertStringContainsString('<ul id="rows">' . $renderer->alone('rows.tpl', $shared, ['items' => ['x']]) . '</ul>', $document);
    }

    public function testRouteRegionLoaderMustBeDeclared(): void
    {
        // HY-30
        $this->expectException(\InvalidArgumentException::class);
        App::open(__DIR__ . '/fixtures/app.json', self::PROGRAM, [
            'routes' => ['add' => ['post' => fn (): Result => Result::redirect('/')], 'home' => ['regions' => ['rows' => fn (): array => []]]],
        ], 'Z');
    }

    /** @param array<string, string> $form */
    private function keep(array $form, string $method = 'POST'): Response
    {
        return $this->app()->handle(new Request($method, '/_hyper/keep', [], [], $form), $this->session);
    }

    public function testServerKeptValueIsStoredAndApplied(): void
    {
        // HY-37, HY-38, HY-40
        $token = $this->token();
        self::assertSame(204, $this->keep(['_csrf' => $token, 'region' => 'rows', 'path' => 'open', 'value' => 'true'])->status);

        $json = self::json($this->get('/list', self::JSON));
        self::assertSame(false, $json['regions']['rows']['open']);
        self::assertSame(['rows' => ['open' => true]], $json['kept']);
        $document = $this->get('/list')->body;
        self::assertStringContainsString('"rows":{"items":["a\\u003c","b0"],"open":false', $document);
        self::assertStringContainsString('"kept":{"rows":{"open":true}}', $document);
    }

    public function testKeepEndpointRejectsInvalidRequests(): void
    {
        // HY-40
        $token = $this->token();
        self::assertSame(403, $this->keep(['_csrf' => 'wrong', 'region' => 'rows', 'path' => 'open', 'value' => 'true'])->status);
        self::assertSame(400, $this->keep(['_csrf' => $token, 'region' => 'rows', 'path' => 'mode', 'value' => '"b"'])->status);
        self::assertSame(400, $this->keep(['_csrf' => $token, 'region' => 'rows', 'path' => 'view', 'value' => '"y"'])->status);
        self::assertSame(400, $this->keep(['_csrf' => $token, 'region' => 'missing', 'path' => 'open', 'value' => 'true'])->status);
        self::assertSame(400, $this->keep(['_csrf' => $token, 'region' => 'rows', 'path' => 'open', 'value' => 'tru'])->status);
        self::assertSame(405, $this->keep([], 'GET')->status);
        self::assertSame(false, self::json($this->get('/list', self::JSON))['regions']['rows']['open']);
        self::assertSame([], self::json($this->get('/list', self::JSON))['kept']);
    }

    public function testCookieKeptValuesAreSentApartFromTheRegionData(): void
    {
        // HY-17, HY-37, HY-38: only conforming values of cookie paths are sent, in `kept`.
        $cookie = json_encode(['rows' => ['mode' => 'b', 'open' => true, 'view' => 'y'], 'side' => ['count' => 9]]);
        $request = new Request('GET', '/list', self::JSON, cookies: ['hy-keep' => $cookie]);
        $json = self::json($this->app()->handle($request, $this->session));
        self::assertSame(['items' => ['a<', 'b0'], 'open' => false, 'mode' => 'a', 'view' => 'x', 'filter' => ['a' => 1], 'tags' => []], $json['regions']['rows']);
        self::assertSame(['rows' => ['mode' => 'b']], $json['kept']);

        foreach (['{"rows":{"mode":1}}', '{', '{"rows":{"filter":{"a":"s"}}}', '{"rows":{"filter":{"b":1}}}', '{"rows":{"filter":{}}}'] as $value) {
            $ignored = new Request('GET', '/list', self::JSON, cookies: ['hy-keep' => $value]);
            self::assertSame([], self::json($this->app()->handle($ignored, $this->session))['kept'], $value);
        }
        $conforming = new Request('GET', '/list', self::JSON, cookies: ['hy-keep' => '{"rows":{"filter":{"a":2}}}']);
        self::assertSame(['rows' => ['filter' => ['a' => 2]]], self::json($this->app()->handle($conforming, $this->session))['kept']);
    }

    public function testRegionWhoseKeptValuesBreakRenderingRendersWithoutThem(): void
    {
        // HY-38: a conforming value can still fail in the template; the document drops the kept values
        // of that region, and the embedded data no longer contains them.
        $cookies = ['hy-keep' => '{"rows":{"mode":"b","tags":[1]}}'];
        $document = $this->app()->handle(new Request('GET', '/list', cookies: $cookies), $this->session);
        self::assertSame(200, $document->status);
        self::assertStringContainsString('<li>a&lt;</li><li>b0</li>', $document->body);
        self::assertStringContainsString('"kept":{}', $document->body);

        // JSON is not rendered by the server, so it carries every conforming value for the browser to check.
        $json = self::json($this->app()->handle(new Request('GET', '/list', self::JSON, cookies: $cookies), $this->session));
        self::assertSame(['rows' => ['mode' => 'b', 'tags' => [1]]], $json['kept']);
    }

    public function testManifestRejectsInvalidKeep(): void
    {
        // HY-37, HY-40
        foreach (['keep-kind', 'keep-page', 'keep-reserved', 'uses-topic'] as $fixture) {
            try {
                App::open(__DIR__ . "/fixtures/invalid/{$fixture}.json", self::PROGRAM, [], 'Z');
                self::fail("{$fixture} was accepted");
            } catch (\InvalidArgumentException) {
                self::addToAssertionCount(1);
            }
        }
    }

    public function testInvalidUtf8IsRejectedBeforeLoadersAndActions(): void
    {
        // HY-42
        $token = $this->token();
        self::assertSame(400, $this->post('/add', ['_csrf' => $token, 'name' => "bad\xFF"])->status);
        self::assertSame(0, $this->counter->actions);
        self::assertSame(400, $this->app()->handle(new Request('GET', '/', [], ['q' => "\xC3"]), $this->session)->status);
        self::assertSame(400, $this->app()->handle(new Request('GET', '/', [], ['a' => ["\xFF" => ['x' => '1']]]), $this->session)->status);
        self::assertSame(200, $this->app()->handle(new Request('GET', '/', [], [], [], cookies: ['hy-keep' => "\xFF"]), $this->session)->status);
        self::assertSame(200, $this->app()->handle(new Request('GET', '/', [], [], [], cookies: [session_name() => "\xFF"]), $this->session)->status);
        self::assertSame(200, $this->app()->handle(new Request('GET', '/', [], [], [], cookies: ['unrelated' => "\xFF"]), $this->session)->status);
        self::assertSame(400, $this->get('/', ['HX-Current-URL' => "http://x/\xFF"])->status);
        self::assertSame(400, $this->get("/items/\xFF")->status);
        // A request target is ASCII (RFC 9112), so a raw UTF-8 path is rejected as well; a client encodes it.
        self::assertSame(400, $this->get('/items/한')->status);
        self::assertSame(200, $this->get('/items/%ED%95%9C')->status);
    }

    public function testUnhandledExceptionGivesAPlain500(): void
    {
        // HY-43
        foreach ([[], self::JSON] as $headers) {
            $response = $this->get('/items/broken', $headers);
            self::assertSame(500, $response->status);
            self::assertSame('Internal Server Error', $response->body);
        }
    }

    public function testSharedNumberOutsideTheSafeRangeFailsForDocumentAndJson(): void
    {
        // HY-44: shared data is checked as region data is, by the rendering of a document and before JSON.
        $app = App::open(__DIR__ . '/fixtures/app.json', self::PROGRAM, [
            'shared' => fn (): array => ['big' => PHP_INT_MAX],
            'routes' => ['add' => ['post' => fn (): Result => Result::redirect('/')]],
        ], 'Z');
        self::assertSame(500, $app->handle(new Request('GET', '/'), $this->session)->status);
        self::assertSame(500, $app->handle(new Request('GET', '/', self::JSON), $this->session)->status);
    }

    public function testIntegerOutsideTheSafeRangeFailsForDocumentAndJson(): void
    {
        // HY-44
        self::assertSame(500, $this->get('/items/huge')->status);
        self::assertSame(500, $this->get('/items/huge', self::JSON)->status);
        // A float outside the range fails as well, because the data model checks numbers by value.
        self::assertSame(500, $this->get('/items/huge-float')->status);
        self::assertSame(500, $this->get('/items/huge-float', self::JSON)->status);
    }

    public function testNumericDataKeysKeepTheirNames(): void
    {
        // HY-17: merging loader, invalid and shared data keeps numeric keys.
        self::assertSame('{"5":"x","id":"n"}', json_encode(self::json($this->get('/items/numeric', self::JSON))['regions']['content']));
    }

    public function testKeepRejectsLongValues(): void
    {
        // HY-40
        $token = $this->token();
        $long = json_encode(str_repeat('a', 4095));
        self::assertSame(400, $this->keep(['_csrf' => $token, 'region' => 'rows', 'path' => 'open', 'value' => $long])->status);
    }

    public function testKeptValuesOutsideTheDataModelAreIgnoredOrRejected(): void
    {
        // HY-38, HY-40
        $token = $this->token();
        self::assertSame(400, $this->keep(['_csrf' => $token, 'region' => 'rows', 'path' => 'filter', 'value' => '{"a":9007199254740993}'])->status);
        self::assertSame(400, $this->keep(['_csrf' => $token, 'region' => 'rows', 'path' => 'filter', 'value' => '{"a":1e400}'])->status);
        foreach (['{"rows":{"filter":{"a":9007199254740993}}}', '{"rows":{"filter":{"a":1e400}}}'] as $cookie) {
            $response = $this->app()->handle(new Request('GET', '/list', self::JSON, cookies: ['hy-keep' => $cookie]), $this->session);
            self::assertSame(200, $response->status);
            self::assertStringContainsString('"filter":{"a":1}', $response->body);
            self::assertStringContainsString('"kept":{}', $response->body);
        }
    }

    public function testEveryResponseLimitsFraming(): void
    {
        // HY-45
        foreach ([$this->get('/'), $this->get('/missing'), $this->get('/items/broken'), $this->get('/', self::JSON)] as $response) {
            self::assertSame("frame-ancestors 'self'", $response->headers['Content-Security-Policy'] ?? null);
        }
        $framed = App::open(__DIR__ . '/fixtures/app.json', self::PROGRAM, ['routes' => ['add' => ['post' => fn (): Result => Result::redirect('/')]]], 'Z', frameAncestors: "'self' https://admin.example");
        self::assertSame("frame-ancestors 'self' https://admin.example", $framed->handle(new Request('GET', '/'), $this->session)->headers['Content-Security-Policy']);
    }

    public function testKeptEmptyMapIsAMap(): void
    {
        // HY-38 with an empty map, which PHP arrays cannot tell from an empty list: an empty kept map does not
        // replace a map with keys, and an empty list does not replace a map.
        foreach (['{"rows":{"filter":{}}}', '{"rows":{"filter":[]}}'] as $cookie) {
            $request = new Request('GET', '/list', self::JSON, cookies: ['hy-keep' => $cookie]);
            self::assertStringContainsString('"kept":{}', $this->app()->handle($request, $this->session)->body);
        }
    }

    public function testRegionRequestReturnsTheProtocolShape(): void
    {
        // HY-17, HY-18
        $response = $this->get('/items/a%20b', self::JSON);

        self::assertSame(200, $response->status);
        self::assertSame('application/json; charset=utf-8', $response->headers['Content-Type']);
        $token = (string) $this->session->get('_hyper_csrf');
        self::assertSame(
            '{"env":{"timezone":"+09:00"},"route":"item","params":{"id":"a b"},"shared":{"title":"Item","csrf":"' . $token . '"},"regions":{"content":{"id":"a b"}},"kept":{}}',
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

    public function testHtmxRequestIsARegionRequestAndOtherJsonIsADocumentRequest(): void
    {
        // HY-15, HY-18: htmx sends HX-Request; a JSON request without it receives every region.
        self::assertSame(['content'], array_keys(self::json($this->get('/', self::JSON))['regions']));
        self::assertSame(['side', 'content'], array_keys(self::json($this->get('/', ['Accept' => 'application/json']))['regions']));
        self::assertSame('Accept, HX-Request, HX-Current-URL', $this->get('/', self::JSON)->headers['Vary']);
    }

    public function testKeptCookieIsHostOnlyOnHttps(): void
    {
        // HY-39, HY-45: on HTTPS the server reads only __Host-hy-keep, which another host cannot set.
        $https = App::open(__DIR__ . '/fixtures/app.json', self::PROGRAM, [
            'routes' => [
                'add' => ['post' => fn (): Result => Result::redirect('/')],
                'list' => ['regions' => ['rows' => fn (): array => ['items' => [], 'mode' => 'a']]],
            ],
        ], 'Z', https: true);
        $read = fn (array $cookies): array => self::json($https->handle(new Request('GET', '/list', self::JSON, cookies: $cookies), $this->session))['kept'];
        self::assertSame(['rows' => ['mode' => 'b']], $read(['__Host-hy-keep' => '{"rows":{"mode":"b"}}']));
        self::assertSame([], $read(['hy-keep' => '{"rows":{"mode":"b"}}']));
        self::assertSame([], self::json($this->app()->handle(new Request('GET', '/list', self::JSON, cookies: ['__Host-hy-keep' => '{"rows":{"mode":"b"}}']), $this->session))['kept']);
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

    public function testLoaderRedirectAnswersWith303AndPassesFlash(): void
    {
        // HY-50
        $response = $this->get('/items/moved', self::JSON);
        self::assertSame(303, $response->status);
        self::assertSame('/items/new', $response->headers['Location']);
        self::assertSame('', $response->body);
        self::assertSame('moved', self::json($this->get('/', ['Accept' => 'application/json']))['regions']['side']['note']);
        self::assertSame('/api/items/new', $this->get('/api/items/moved', [], '/api')->headers['Location']);
    }

    public function testForbiddenLoaderAndActionAnswerWith403(): void
    {
        // HY-51
        $page = $this->get('/items/private');
        self::assertSame(403, $page->status);
        self::assertSame('Forbidden', $page->body);
        $action = $this->post('/add', ['_csrf' => $this->token(), 'name' => 'closed']);
        self::assertSame(403, $action->status);
        self::assertSame(0, $this->counter->count);
    }

    public function testReplyCookiesAndCacheControlReachTheResponse(): void
    {
        // HY-52
        $page = $this->get('/items/member');
        self::assertSame(200, $page->status);
        self::assertSame([
            'member=token.1; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600',
            'old=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
        ], $page->headers['Set-Cookie']);
        self::assertSame('public, max-age=60', $page->headers['Cache-Control']);
        $https = $this->app()->handle(new Request('GET', '/items/member', [], https: true), $this->session);
        self::assertSame('member=token.1; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=3600', $https->headers['Set-Cookie'][0]);
        $forbidden = $this->get('/items/guarded');
        self::assertSame(403, $forbidden->status);
        self::assertSame(['member=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'], $forbidden->headers['Set-Cookie']);
        self::assertSame(500, $this->get('/items/bad-cookie')->status);
        self::assertArrayNotHasKey('Set-Cookie', $this->get('/items/plain')->headers);
    }

    public function testPageResponsesAreNotStoredUnlessTheReplySetsCacheControl(): void
    {
        // HY-52: documents and JSON have no-store by default, and only a page with status 200 takes the reply value.
        self::assertSame('no-store', $this->get('/items/plain')->headers['Cache-Control']);
        self::assertSame('no-store', $this->get('/items/plain', self::JSON)->headers['Cache-Control']);
        $token = $this->token();
        self::assertSame('no-store', $this->post('/add', ['_csrf' => $token, 'name' => ''])->headers['Cache-Control']);
        self::assertSame('public, max-age=60', $this->get('/items/member', self::JSON)->headers['Cache-Control']);
    }

    public function testJsonResponsesHaveATagAndMatchingRequestsGet304(): void
    {
        // HY-53
        $first = $this->get('/items/plain', ['Accept' => 'application/json']);
        $tag = $first->headers['ETag'];
        self::assertSame('"' . substr(hash('sha256', $first->body), 0, 32) . '"', $tag);
        $again = $this->get('/items/plain', ['Accept' => 'application/json', 'If-None-Match' => $tag]);
        self::assertSame(304, $again->status);
        self::assertSame('', $again->body);
        self::assertSame($tag, $again->headers['ETag']);
        self::assertSame(200, $this->get('/items/plain', ['Accept' => 'application/json', 'If-None-Match' => '"other"'])->status);
    }

    public function testHandlersMustMatchTheManifest(): void
    {
        // HY-2
        $this->expectException(\InvalidArgumentException::class);
        App::open(__DIR__ . '/fixtures/app.json', self::PROGRAM, ['routes' => ['unknown' => []]], 'Z');
    }

    public function testDeclaredPostRouteNeedsAnAction(): void
    {
        // HY-2
        $this->expectException(\InvalidArgumentException::class);
        App::open(__DIR__ . '/fixtures/app.json', self::PROGRAM, [], 'Z');
    }
}
