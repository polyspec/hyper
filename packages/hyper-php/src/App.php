<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

use Polyspec\Template\Value\Bind;

/** Answers requests with documents, JSON, action redirects and the static shell (HY-8, HY-10 to HY-19, HY-24 to HY-27, HY-58 to HY-60, HY-62). */
final class App
{
    private readonly Container $container;
    private readonly Renderer $renderer;

    /**
     * @param array<string, \Closure> $regionLoaders
     * @param array<string, array{load?: \Closure, post?: \Closure, regions?: array<string, \Closure>}> $routeHandlers
     */
    private function __construct(
        private readonly Manifest $manifest,
        private readonly ?\Closure $shared,
        private readonly array $regionLoaders,
        private readonly array $routeHandlers,
        private readonly string $timezone,
        private readonly string $basePath,
        private readonly bool $https,
        private readonly string $frameAncestors,
        private readonly int $bodyLimit,
        private readonly int $responseLimit,
        /** @var list<string> */
        private readonly array $formTypes,
        private readonly ?\Closure $onResponse,
        private readonly ?ClientRendering $client,
        private readonly ?\Closure $onDisconnect,
        /** The bytes of the static shell of the client rendering (HY-62). */
        private readonly string $shell,
        string $program,
    ) {
        $this->container = new Container();
        $this->renderer = Renderer::open($program, $timezone);
    }

    /**
     * Creates an application from its manifest, the server program that `scripts/build-server.mjs` built from
     * its templates (HY-48) and the handlers that load data and run actions.
     *
     * The body limit is the largest request body in bytes, and the form types are the media types of the request
     * bodies that actions and `/_hyper/keep` accept (HY-59). The response limit is the largest response body in
     * bytes that the server sends (HY-66).
     *
     * @param array{shared?: \Closure, regions?: array<string, \Closure>, routes?: array<string, array{load?: \Closure, post?: \Closure, regions?: array<string, \Closure>}>} $handlers
     * @param list<string> $formTypes `application/x-www-form-urlencoded` and `multipart/form-data`
     * @param ?\Closure(Request, Response, float, Reply): void $onResponse called once for every response with the
     *     request, the response, the elapsed milliseconds and the reply of the request, which is empty when the
     *     server answered before routing (HY-60)
     * @param ?ClientRendering $clientRendering the client-rendered pages, which receive the static shell for HTML
     *     requests and JSON under the data base path (HY-62)
     * @param ?\Closure(Request, float, Reply): void $onDisconnect called once with the request, the elapsed
     *     milliseconds and the reply of a request whose client closed the connection, which PHP reports at the
     *     first failed write of the response (HY-67)
     */
    public static function open(
        string $manifest,
        string $program,
        array $handlers,
        string $timezone,
        string $basePath = '',
        bool $https = false,
        string $frameAncestors = "'self'",
        int $bodyLimit = 8 * 1024 * 1024,
        array $formTypes = ['application/x-www-form-urlencoded'],
        int $responseLimit = 8 * 1024 * 1024,
        ?\Closure $onResponse = null,
        ?ClientRendering $clientRendering = null,
        ?\Closure $onDisconnect = null,
    ): self {
        if ($bodyLimit < 1) {
            throw new \InvalidArgumentException("body limit {$bodyLimit} is not a positive number of bytes");
        }
        if ($responseLimit < 1) {
            throw new \InvalidArgumentException("response limit {$responseLimit} is not a positive number of bytes");
        }
        if ($formTypes === [] || array_values(array_unique($formTypes)) !== $formTypes || array_diff($formTypes, ['application/x-www-form-urlencoded', 'multipart/form-data']) !== []) {
            throw new \InvalidArgumentException('form types must be distinct values of application/x-www-form-urlencoded and multipart/form-data');
        }
        if ($basePath !== '' && (!str_starts_with($basePath, '/') || str_ends_with($basePath, '/'))) {
            throw new \InvalidArgumentException("base path {$basePath} must start with / and must not end with /");
        }
        $declared = Manifest::fromFile($manifest);

        $regionLoaders = $handlers['regions'] ?? [];
        foreach (array_keys($regionLoaders) as $name) {
            $region = array_values(array_filter($declared->regions, fn (Region $region): bool => $region->name === $name))[0] ?? null;
            if ($region === null || $region->page) {
                throw new \InvalidArgumentException("region loader {$name} has no non-page region in the manifest");
            }
        }
        $routeHandlers = $handlers['routes'] ?? [];
        foreach ($routeHandlers as $name => $handler) {
            if (!isset($declared->routes[$name])) {
                throw new \InvalidArgumentException("route handler {$name} has no route in the manifest");
            }
            if (isset($handler['post']) !== $declared->routes[$name]['post']) {
                throw new \InvalidArgumentException("route {$name} must have a POST action exactly when the manifest declares post");
            }
            $routeRegions = array_map(fn (Region $region): string => $region->name, $declared->routes[$name]['regions']);
            foreach (array_keys($handler['regions'] ?? []) as $regionName) {
                if (!in_array($regionName, $routeRegions, true)) {
                    throw new \InvalidArgumentException("route {$name} has a loader for undeclared region {$regionName}");
                }
            }
        }
        foreach ($declared->routes as $name => $route) {
            if ($route['post'] && !isset($routeHandlers[$name]['post'])) {
                throw new \InvalidArgumentException("route {$name} declares post but has no POST action");
            }
        }

        $shell = $clientRendering === null ? '' : self::shell($clientRendering, $declared);

        return new self($declared, $handlers['shared'] ?? null, $regionLoaders, $routeHandlers, $timezone, $basePath, $https, $frameAncestors, $bodyLimit, $responseLimit, array_values($formTypes), $onResponse, $clientRendering, $onDisconnect, $shell, $program);
    }

    /** Reads the static shell after checking the declaration of the client rendering against the manifest (HY-62). */
    private static function shell(ClientRendering $client, Manifest $manifest): string
    {
        $base = $client->basePath;
        if ($base === '' || !str_starts_with($base, '/') || str_ends_with($base, '/')) {
            throw new \InvalidArgumentException("data base path {$base} must start with / and must not end with /");
        }
        foreach ($manifest->routes as $name => $route) {
            if ($route['path'] === $base || str_starts_with($route['path'], "{$base}/")) {
                throw new \InvalidArgumentException("route {$name} lies under the data base path {$base}");
            }
        }
        if (!str_starts_with($client->shell, '/') || !is_file($client->shell) || !is_readable($client->shell)) {
            throw new \InvalidArgumentException("static shell {$client->shell} is not a readable file at an absolute path");
        }
        $shell = (string) file_get_contents($client->shell);
        if (!str_contains($shell, '<meta name="hyper-api" content="' . htmlspecialchars($base, ENT_QUOTES) . '">')) {
            throw new \InvalidArgumentException("static shell {$client->shell} does not declare the data base path {$base}");
        }

        return $shell;
    }

    /** Registers the factory of an application service. */
    public function bind(string $class, \Closure $factory): void
    {
        $this->container->bind($class, $factory);
    }

    /**
     * Answers one request; an unhandled exception and a body larger than the response limit give a plain 500 and
     * are logged (HY-43, HY-66). Every response limits framing (HY-45), every failure is not cacheable (HY-65), and
     * every response is reported to onResponse with the milliseconds since `$started`, a microtime(true) value that
     * defaults to now (HY-60).
     */
    public function handle(Request $request, SessionStore $store, ?float $started = null): Response
    {
        return $this->respond($request, $store, $started ?? microtime(true), new Reply());
    }

    /** Answers one request with the reply that its loaders and actions receive (HY-60). */
    private function respond(Request $request, SessionStore $store, float $started, Reply $reply): Response
    {
        try {
            $response = $this->answer($request, $store, $reply);
        } catch (\Throwable $error) {
            error_log(sprintf('hyper: %s: %s in %s:%d', $error::class, $error->getMessage(), $error->getFile(), $error->getLine()));
            $response = Response::text(500, 'Internal Server Error');
        }
        $size = strlen($response->body);
        if ($size > $this->responseLimit) {
            error_log("hyper: the response to {$request->method} {$request->path} has {$size} bytes, more than the response limit of {$this->responseLimit} bytes");
            $response = Response::text(500, 'Internal Server Error');
        }

        $response = $response->withHeader('Content-Security-Policy', "frame-ancestors {$this->frameAncestors}");
        if ($response->status >= 400) {
            $response = $response->withHeader('Cache-Control', 'no-store');
        }
        if ($this->onResponse !== null) {
            ($this->onResponse)($request, $response, (microtime(true) - $started) * 1000, $reply);
        }

        return $response;
    }

    /** Answers a request; the loaders and actions of a routed request receive `$reply` (HY-52, HY-60). */
    private function answer(Request $request, SessionStore $store, Reply $reply): Response
    {
        if ($request->bodySize() > $this->bodyLimit) {
            return Response::text(413, 'Content Too Large');
        }
        if (!$request->validInput()) {
            return Response::text(400, 'Bad Request');
        }
        $client = $this->chosen($request);
        $basePath = $client?->basePath ?? $this->basePath;
        $path = Router::stripBasePath($request->path, $basePath);
        if ($client !== null && $path === null) {
            return $this->shellResponse($request);
        }
        if ($path === '/_hyper/keep') {
            return $this->keep($request, new Session($store));
        }
        $match = $path === null ? null : $this->manifest->router->match($path);
        if ($match === null) {
            return Response::text(404, 'Not Found');
        }
        $route = $this->manifest->routes[$match['name']];
        $handler = $this->routeHandlers[$route['name']] ?? [];
        if ($client !== null) {
            // HY-62: the data base path answers only JSON requests and actions, before the session is read.
            if ($request->method !== 'GET' && ($request->method !== 'POST' || !isset($handler['post']))) {
                return Response::text(405, 'Method Not Allowed');
            }
            if (!$request->wantsJson()) {
                return Response::text(406, 'Not Acceptable');
            }
        }
        $session = new Session($store);
        $flash = $session->takeFlash();
        $request = $request->withRoute((string) $path, $match['params'])->withSession($flash, $session->csrfToken());

        return $this->routed($request, $route, $handler, $session, $flash, $reply, $basePath)->withCookies($reply, $this->https || $request->https);
    }

    /** Returns the client rendering when its selection chooses the request, and null otherwise (HY-62). */
    private function chosen(Request $request): ?ClientRendering
    {
        if ($this->client === null) {
            return null;
        }
        $chosen = ($this->client->selects)($request);
        if (!is_bool($chosen)) {
            throw new \LogicException('the selection of the client rendering did not return a boolean');
        }

        return $chosen ? $this->client : null;
    }

    /** Answers a client-rendered request outside the data base path: the static shell for a page (HY-62). */
    private function shellResponse(Request $request): Response
    {
        if ($this->manifest->router->match($request->path) === null) {
            return Response::text(404, 'Not Found');
        }
        if ($request->method !== 'GET') {
            return Response::text(405, 'Method Not Allowed');
        }
        if ($request->wantsJson()) {
            return Response::text(406, 'Not Acceptable');
        }

        return new Response(200, ['Content-Type' => 'text/html; charset=utf-8', 'Cache-Control' => 'no-cache', 'Vary' => 'Accept'], $this->shell);
    }

    /**
     * Answers a routed request with its page, action result or stop result.
     *
     * @param array{name: string, path: string, title: string, template: string, post: bool, regions: list<Region>} $route
     * @param array{load?: \Closure, post?: \Closure, regions?: array<string, \Closure>} $handler
     */
    private function routed(Request $request, array $route, array $handler, Session $session, Flash $flash, Reply $reply, string $basePath): Response
    {
        try {
            if ($request->method === 'GET') {
                return $this->page($request, $route, $handler, $session, $flash, 200, [], $reply, $basePath);
            }
            if ($request->method !== 'POST' || !isset($handler['post'])) {
                return Response::text(405, 'Method Not Allowed');
            }
            if (!in_array($request->mediaType(), $this->formTypes, true)) {
                return Response::text(415, 'Unsupported Media Type');
            }
            if (!hash_equals($request->csrfToken(), $request->formString('_csrf'))) {
                return Response::text(403, 'Forbidden');
            }
            $result = $this->container->call($handler['post'], [Request::class => $request, Reply::class => $reply]);
            if (!$result instanceof Result) {
                throw new \LogicException("POST action of route {$route['name']} did not return a Result");
            }
            if ($result->isRedirect()) {
                return $this->redirect($session, $result, $basePath);
            }

            return $this->page($request, $route, $handler, $session, $flash, $result->status, $result->data, $reply, $basePath);
        } catch (NotFound) {
            return Response::text(404, 'Not Found');
        } catch (Redirect $redirect) {
            return $this->redirect($session, $redirect->result, $basePath);
        } catch (Forbidden) {
            return Response::text(403, 'Forbidden');
        } catch (BadRequest) {
            return Response::text(400, 'Bad Request');
        }
    }

    /** Stores the flash values and changed topics of a redirect result and answers 303 (HY-25, HY-50). */
    private function redirect(Session $session, Result $result, string $basePath): Response
    {
        $session->putFlash(new Flash($result->flash, $result->changed));

        return new Response(303, ['Location' => $basePath . $result->location], '');
    }

    /**
     * Renders the route page as a document or as JSON.
     *
     * @param array{name: string, path: string, title: string, template: string, post: bool, regions: list<Region>} $route
     * @param array{load?: \Closure, post?: \Closure, regions?: array<string, \Closure>} $handler
     * @param array<string, mixed> $invalid
     */
    private function page(Request $request, array $route, array $handler, Session $session, Flash $flash, int $status, array $invalid, Reply $reply, string $basePath): Response
    {
        $json = $request->wantsJson();
        $provided = [Request::class => $request, Reply::class => $reply];
        $shared = ['title' => $route['title'], 'csrf' => $request->csrfToken()];
        if ($this->shared !== null) {
            $shared = array_replace($shared, $this->container->call($this->shared, $provided));
        }

        $changed = RegionPlanner::changedTopics($request, $flash, $basePath);
        $data = [];
        $templates = [];
        foreach (RegionPlanner::select($this->manifest, !$request->isRegionRequest(), $changed) as $selected) {
            if ($selected->page) {
                $loaded = isset($handler['load']) ? $this->container->call($handler['load'], $provided) : [];
                $data[$selected->name] = array_replace($loaded, $invalid);
                $templates[$selected->name] = $route['template'];
                foreach ($route['regions'] as $routeRegion) {
                    $loader = $handler['regions'][$routeRegion->name] ?? null;
                    $data[$routeRegion->name] = $loader === null ? [] : $this->container->call($loader, $provided);
                    $templates[$routeRegion->name] = (string) $routeRegion->template;
                }
            } else {
                $loader = $this->regionLoaders[$selected->name] ?? null;
                $data[$selected->name] = $loader === null ? [] : $this->container->call($loader, $provided);
                $templates[$selected->name] = (string) $selected->template;
            }
        }

        $kept = $this->kept($request, $session, $data);
        $vary = 'Accept, HX-Request, HX-Current-URL';
        if ($json) {
            $response = JsonEncoder::value($this->timezone, $route['name'], $request->params(), $shared, $data, $kept);
            // HY-44: every value must belong to the template data model, for JSON as for a document.
            Bind::value($response);

            $body = JsonEncoder::encode($response);
            $headers = [
                'Content-Type' => 'application/json; charset=utf-8',
                'Cache-Control' => $status === 200 ? ($reply->cacheControlValue() ?? 'no-store') : 'no-store',
                'Vary' => $vary,
            ];
            if ($status !== 200) {
                return new Response($status, $headers, $body);
            }
            // HY-53: a strong tag of the body; a matching GET request receives 304 without a body.
            $tag = '"' . substr(hash('sha256', $body), 0, 32) . '"';
            $headers['ETag'] = $tag;

            return $request->method === 'GET' && $request->header('If-None-Match') === $tag ? new Response(304, $headers, '') : new Response(200, $headers, $body);
        }

        $headers = [
            'Content-Type' => 'text/html; charset=utf-8',
            'Cache-Control' => $status === 200 ? ($reply->cacheControlValue() ?? 'no-store') : 'no-store',
            'Vary' => $vary,
        ];

        return new Response($status, $headers, $this->document($request, $route, $shared, $data, $templates, $kept));
    }

    /**
     * Returns the conforming `server` and `cookie` kept values of the regions, by region and path (HY-17, HY-38).
     *
     * @param array<string, array<string, mixed>> $data
     * @return array<string, array<string, mixed>>
     */
    private function kept(Request $request, Session $session, array $data): array
    {
        // On HTTPS only the host-only cookie counts, which another host cannot set (HY-39).
        $cookie = json_decode($request->cookie($this->https || $request->https ? '__Host-hy-keep' : 'hy-keep') ?? '');
        $kept = [];
        foreach ($data as $name => $regionData) {
            $region = $this->manifest->region($name);
            if ($region === null) {
                continue;
            }
            $stored = $session->kept($name);
            $values = [];
            foreach ($region->keep as $keptPath => $kind) {
                $source = match ($kind) {
                    'server' => $stored,
                    'cookie' => $cookie instanceof \stdClass && ($cookie->{$name} ?? null) instanceof \stdClass ? get_object_vars($cookie->{$name}) : [],
                    default => [],
                };
                if (array_key_exists($keptPath, $source)) {
                    $values[] = [$keptPath, $source[$keptPath]];
                }
            }
            $selected = Kept::select($regionData, $values);
            if ($selected !== []) {
                $kept[$name] = $selected;
            }
        }

        return $kept;
    }

    /**
     * Renders the document with the kept values applied. When that fails, every region whose rendering alone
     * fails with its kept values renders with its loader data, route regions first, and its kept values leave
     * the embedded data (HY-31, HY-38).
     *
     * @param array{name: string, path: string, title: string, template: string, post: bool, regions: list<Region>} $route
     * @param array<string, mixed> $shared
     * @param array<string, array<string, mixed>> $data
     * @param array<string, string> $templates
     * @param array<string, array<string, mixed>> $kept
     */
    private function document(Request $request, array $route, array $shared, array $data, array $templates, array $kept): string
    {
        $applied = [];
        foreach ($data as $name => $regionData) {
            $pairs = array_map(null, array_keys($kept[$name] ?? []), array_values($kept[$name] ?? []));
            $applied[$name] = Kept::apply($regionData, $pairs);
        }
        try {
            return $this->renderDocument($request, $route, $shared, $data, $applied, $templates, $kept);
        } catch (\Throwable $error) {
            if ($kept === []) {
                throw $error;
            }
        }
        $page = $this->manifest->page->name;
        $routeRegions = array_map(fn (Region $region): string => $region->name, $route['regions']);
        $others = array_values(array_diff(array_keys($data), [...$routeRegions, $page]));
        foreach ([...$routeRegions, ...$others, $page] as $name) {
            if (!isset($kept[$name])) {
                continue;
            }
            try {
                $define = [];
                if ($name === $page) {
                    foreach ($routeRegions as $routeRegion) {
                        $define[$routeRegion] = ['template' => $templates[$routeRegion], 'data' => $applied[$routeRegion]];
                    }
                }
                $this->renderer->alone($templates[$name], $shared, $applied[$name], $define);
            } catch (\Throwable) {
                $applied[$name] = $data[$name];
                unset($kept[$name]);
            }
        }

        return $this->renderDocument($request, $route, $shared, $data, $applied, $templates, $kept);
    }

    /**
     * @param array{name: string, path: string, title: string, template: string, post: bool, regions: list<Region>} $route
     * @param array<string, mixed> $shared
     * @param array<string, array<string, mixed>> $data loader data, which the embedded data carries
     * @param array<string, array<string, mixed>> $applied region data with kept values applied, which the regions render
     * @param array<string, string> $templates
     * @param array<string, array<string, mixed>> $kept
     */
    private function renderDocument(Request $request, array $route, array $shared, array $data, array $applied, array $templates, array $kept): string
    {
        // HY-44: rendering binds every value of the regions and of the embedded response, so a value outside the
        // data model fails the document there; JSON, which is not rendered, is checked before it is encoded.
        $response = JsonEncoder::value($this->timezone, $route['name'], $request->params(), $shared, $data, $kept);
        $routeRegionNames = array_map(fn (Region $region): string => $region->name, $route['regions']);
        $regions = [];
        $routeRegions = [];
        foreach ($applied as $name => $regionData) {
            $region = ['template' => $templates[$name], 'data' => $regionData];
            if (in_array($name, $routeRegionNames, true)) {
                $routeRegions[$name] = $region;
            } else {
                $regions[$name] = $region;
            }
        }

        return $this->renderer->document($this->manifest->layout, $this->manifest->title, $shared, $regions, $this->manifest->page->name, $routeRegions, $response);
    }

    /** Stores a kept value of a `server` path in the session (HY-40). */
    private function keep(Request $request, Session $session): Response
    {
        if ($request->method !== 'POST') {
            return Response::text(405, 'Method Not Allowed');
        }
        if (!in_array($request->mediaType(), $this->formTypes, true)) {
            return Response::text(415, 'Unsupported Media Type');
        }
        if (!hash_equals($session->csrfToken(), $request->formString('_csrf'))) {
            return Response::text(403, 'Forbidden');
        }
        $name = $request->formString('region');
        $path = $request->formString('path');
        $region = $this->manifest->region($name);
        if ($region === null || ($region->keep[$path] ?? null) !== 'server') {
            return Response::text(400, 'Bad Request');
        }
        $text = $request->formString('value');
        if (strlen($text) > 4096) {
            return Response::text(400, 'Bad Request');
        }
        try {
            $value = json_decode($text, false, flags: JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return Response::text(400, 'Bad Request');
        }
        if (!Kept::inDataModel($value)) {
            return Response::text(400, 'Bad Request');
        }
        $session->keep($name, $path, $value);

        return new Response(204, [], '');
    }

    /**
     * Answers the current PHP request with the PHP session and writes the response; errors go to the log only.
     * A response without a body receives no Content-Type from PHP (HY-52), and a client that closed the connection
     * ends the script at the first failed write and is reported to the disconnect hook (HY-67).
     */
    public function run(): void
    {
        // HY-59: PHP drops a body larger than post_max_size, and gives the body of a multipart request to
        // php://input only when enable_post_data_reading is off.
        $postMaxSize = ini_parse_quantity((string) ini_get('post_max_size'));
        if ($postMaxSize > 0 && $postMaxSize < $this->bodyLimit) {
            throw new \LogicException("body limit {$this->bodyLimit} is larger than post_max_size {$postMaxSize}");
        }
        if (in_array('multipart/form-data', $this->formTypes, true) && filter_var(ini_get('enable_post_data_reading'), FILTER_VALIDATE_BOOL)) {
            throw new \LogicException('multipart/form-data is accepted, so enable_post_data_reading must be off');
        }
        ini_set('display_errors', '0');
        ini_set('log_errors', '1');
        ini_set('default_mimetype', '');
        // HY-67: PHP reports a closed connection only at a failed write; with ignore_user_abort off it ends the
        // script there, and the shutdown function calls the disconnect hook.
        ignore_user_abort(false);
        // The elapsed time of HY-60 counts from the start of the PHP request.
        $started = $_SERVER['REQUEST_TIME_FLOAT'] ?? null;
        $started = is_float($started) ? $started : microtime(true);
        $request = Request::fromGlobals();
        $reply = new Reply();
        if ($this->onDisconnect !== null) {
            $hook = $this->onDisconnect;
            register_shutdown_function(static function () use ($hook, $request, $started, $reply): void {
                if (connection_aborted() === 1) {
                    $hook($request, (microtime(true) - $started) * 1000, $reply);
                }
            });
        }
        $this->respond($request, new NativeSession($this->https), $started, $reply)->send();
    }
}
