<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * Answers requests with documents, JSON, action redirects and the static shell (HY-8, HY-10 to HY-19, HY-24 to HY-27,
 * HY-58 to HY-60, HY-62).
 *
 * @phpstan-import-type RouteDefinition from Manifest
 * @phpstan-type RouteHandler array{
 *     load?: \Closure,
 *     post?: \Closure,
 *     regions?: array<string, \Closure>,
 *     representations?: array<string, \Closure>
 * }
 * @phpstan-type Handlers array{shared?: \Closure, regions?: array<string, \Closure>, routes?: array<string,
 *     RouteHandler>}
 */
final class App
{
    private readonly Container $container;

    /** The page rendering of the application, which answers a routed request with its document or JSON. */
    private readonly Page $page;

    /** The error types that end the script with a fatal error, which `run` answers with the plain 500 (HY-60). */
    private const FATAL = [E_ERROR, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR];

    /** The media type of a document (HY-15, HY-116). */
    private const PAGE_TYPE = 'text/html';

    /** The media type of a JSON response (HY-15, HY-116). */
    private const DATA_TYPE = 'application/vnd.hyper+json';

    /** Whether the response hook has been called for the request that `run` answers (HY-60). */

    /**
     * @param ?\Closure $shared the shared handler, or null without one
     * @param array<string, \Closure> $regionLoaders
     * @param array<string, RouteHandler> $routeHandlers
     * @param array<string, callable(): mixed> $functions
     */
    private function __construct(
        private readonly Manifest $manifest,
        ?\Closure $shared,
        array $regionLoaders,
        private readonly array $routeHandlers,
        string $timezone,
        private readonly string $basePath,
        private readonly bool $https,
        private readonly string $frameAncestors,
        private readonly int $bodyLimit,
        private readonly int $fileLimit,
        private readonly int $valueLimit,
        private readonly int $partLimit,
        private readonly int $responseLimit,
        /** @var list<string> */
        private readonly array $formTypes,
        private readonly ?\Closure $onResponse,
        private readonly ?ClientRendering $client,
        private readonly ?\Closure $onDisconnect,
        private readonly ?\Closure $written,
        private readonly ?\Closure $around,
        private readonly ?\Closure $sessionSetup,
        /** The bytes of the static shell of the client rendering (HY-62). */
        private readonly string $shell,
        /** The context handler, which returns the context of the application (HY-124), or null without one. */
        private readonly ?\Closure $context,
        /** The host functions of the application, which the engine registers (HYC-24). */
        array $functions,
        string $program,
    ) {
        $this->container = new Container();
        $this->page = new Page(
            $manifest,
            $shared,
            $regionLoaders,
            $this->container,
            Renderer::open($program, $timezone, $functions),
            Reads::open($program),
            Build::read("{$program}/build.json"),
            $timezone,
            $https,
            $context,
            $this->varyHeader(),
        );
    }

    /**
     * Creates an application from its manifest, the server program that `hyper-build-server` of
     * `@polyspec/hyper-build` built from its templates (HY-48) and the handlers that load data and run actions.
     *
     * The body limit is the largest request body in bytes, and the form types are the media types of the request
     * bodies that actions and `/_hyper/keep` accept (HY-59). The response limit is the largest response body in
     * bytes that the server sends (HY-66).
     *
     * @param Handlers $handlers
     * @param list<string> $formTypes `application/x-www-form-urlencoded` and `multipart/form-data`
     * @param ?\Closure(Request, Response, float, Reply, ?string): void $onResponse called once for every response with
     *     the request, the response, the elapsed milliseconds, the reply of the request, which is empty when the
     *     server answered before routing, and the failure of a 500 of HY-43 or HY-66, else null (HY-60)
     * @param ?ClientRendering $clientRendering the client-rendered pages, which receive the static shell for HTML
     *     requests and JSON under the data base path (HY-62)
     * @param ?\Closure(Request, float, Reply): void $onDisconnect called once with the request, the elapsed
     *     milliseconds and the reply of a request whose client closed the connection, which PHP reports at the
     *     first failed write of the response (HY-67)
     * @param ?\Closure(Request, ?Response, bool, float, ?string): void $written called once for every request that the
     *     run answers, with the response whose write started, the plain 500 of an escaped error, or null when the
     *     request ended before a response started; whether the write ended, the elapsed milliseconds and the failure of
     *     an escaped error (HY-99)
     * @param ?\Closure(Request, \Closure(Request): Response): Response $around called once for every request with the
     *     request and the function `answer`, which runs the application for a request; the server sends the response
     *     that `around` returns (HY-97)
     * @param ?\Closure(): void $sessionSetup called just before a session starts, for the settings of the session
     *     that a request reads, such as the primary of `RedisSentinelSessions`; an error fails the request (HY-115)
     * @param ?\Closure(mixed): array<string, mixed> $context the context handler, which receives the selection value and returns the
     *     context of the application, a map of the data model (HY-124)
     * @param array<string, callable(): mixed> $functions the host functions of the application, a map from names to functions,
     *     which the template engine registers (HYC-24, HY-106)
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
        ?int $fileLimit = null,
        int $responseLimit = 8 * 1024 * 1024,
        ?int $valueLimit = null,
        int $partLimit = 1000,
        ?\Closure $onResponse = null,
        ?ClientRendering $clientRendering = null,
        ?\Closure $onDisconnect = null,
        ?\Closure $written = null,
        ?\Closure $around = null,
        ?\Closure $sessionSetup = null,
        ?\Closure $context = null,
        array $functions = [],
    ): self {
        if ($bodyLimit < 1) {
            throw new \InvalidArgumentException("body limit {$bodyLimit} is not a positive number of bytes");
        }
        $fileLimit ??= min(8 * 1024 * 1024, $bodyLimit);
        if ($fileLimit < 1 || $fileLimit > $bodyLimit) {
            throw new \InvalidArgumentException(
                "file limit {$fileLimit} is not a positive number of bytes no larger than the body limit "
                . "{$bodyLimit} (HY-114)",
            );
        }
        $valueLimit ??= min(8 * 1024 * 1024, $bodyLimit);
        if ($valueLimit < 1 || $valueLimit > $bodyLimit) {
            throw new \InvalidArgumentException(
                "value limit {$valueLimit} is not a positive number of bytes no larger than the body limit "
                . "{$bodyLimit} (HY-131)",
            );
        }
        if ($partLimit < 1) {
            throw new \InvalidArgumentException("part limit {$partLimit} is not a positive number (HY-131)");
        }
        if ($responseLimit < 1) {
            throw new \InvalidArgumentException("response limit {$responseLimit} is not a positive number of bytes");
        }
        if (
            $formTypes === []
            || array_values(array_unique($formTypes)) !== $formTypes
            || array_diff($formTypes, ['application/x-www-form-urlencoded', 'multipart/form-data']) !== []
        ) {
            throw new \InvalidArgumentException(
                'form types must be distinct values of application/x-www-form-urlencoded and multipart/form-data',
            );
        }
        if ($basePath !== '' && (!str_starts_with($basePath, '/') || str_ends_with($basePath, '/'))) {
            throw new \InvalidArgumentException("base path {$basePath} must start with / and must not end with /");
        }
        $declared = Manifest::fromFile($manifest);

        self::checkHandlers($declared, $handlers);

        $shell = $clientRendering === null ? '' : self::checkedShell($clientRendering, $declared);

        return new self(
            $declared,
            $handlers['shared'] ?? null,
            $handlers['regions'] ?? [],
            $handlers['routes'] ?? [],
            $timezone,
            $basePath,
            $https,
            $frameAncestors,
            $bodyLimit,
            $fileLimit,
            $valueLimit,
            $partLimit,
            $responseLimit,
            $formTypes,
            $onResponse,
            $clientRendering,
            $onDisconnect,
            $written,
            $around,
            $sessionSetup,
            $shell,
            $context,
            $functions,
            $program,
        );
    }

    /** Reads the static shell after checking the declaration of the client rendering against the manifest (HY-62). */
    private static function checkedShell(ClientRendering $client, Manifest $manifest): string
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
            throw new \InvalidArgumentException(
                "static shell {$client->shell} is not a readable file at an absolute path",
            );
        }
        $shell = file_get_contents($client->shell);
        if ($shell === false) {
            throw new \InvalidArgumentException("static shell {$client->shell} cannot be read");
        }
        if (preg_match('//u', $shell) !== 1) {
            throw new \InvalidArgumentException("static shell {$client->shell} is not valid UTF-8");
        }
        if (!str_contains($shell, '<meta name="hyper-api" content="' . htmlspecialchars($base, ENT_QUOTES) . '">')) {
            throw new \InvalidArgumentException(
                "static shell {$client->shell} does not declare the data base path {$base}",
            );
        }

        return $shell;
    }

    /**
     * Checks the handlers against the manifest: every region loader has a region that is no page, every route handler
     * has a route, a route has a POST action exactly when the manifest declares post, every loader of a route region
     * has its region, and the representation handlers of a route are those of its entries (HY-118).
     *
     * @param Handlers $handlers
     */
    private static function checkHandlers(Manifest $manifest, array $handlers): void
    {
        $regionLoaders = $handlers['regions'] ?? [];
        foreach (array_keys($regionLoaders) as $name) {
            $region = array_values(
                array_filter($manifest->regions, fn (Region $region): bool => $region->name === $name),
            )[0] ?? null;
            if ($region === null || $region->page) {
                throw new \InvalidArgumentException("region loader {$name} has no non-page region in the manifest");
            }
        }
        $routeHandlers = $handlers['routes'] ?? [];
        foreach ($routeHandlers as $name => $handler) {
            if (!isset($manifest->routes[$name])) {
                throw new \InvalidArgumentException("route handler {$name} has no route in the manifest");
            }
            if (isset($handler['post']) !== $manifest->routes[$name]['post']) {
                throw new \InvalidArgumentException(
                    "route {$name} must have a POST action exactly when the manifest declares post",
                );
            }
            $routeRegions = array_map(
                fn (Region $region): string => $region->name,
                $manifest->routes[$name]['regions'],
            );
            foreach (array_keys($handler['regions'] ?? []) as $regionName) {
                if (!in_array($regionName, $routeRegions, true)) {
                    throw new \InvalidArgumentException(
                        "route {$name} has a loader for undeclared region {$regionName}",
                    );
                }
            }
        }
        foreach ($manifest->routes as $name => $route) {
            if ($route['post'] && !isset($routeHandlers[$name]['post'])) {
                throw new \InvalidArgumentException("route {$name} declares post but has no POST action");
            }
            RepresentationEntries::checkHandlers(
                $name,
                $route['representations'],
                $routeHandlers[$name]['representations'] ?? [],
            );
        }
    }

    /** Registers the factory of an application service. */
    public function bind(string $class, \Closure $factory): void
    {
        $this->container->bind($class, $factory);
    }

    /**
     * Answers one request; an unhandled exception and a body larger than the response limit give a plain 500 and
     * are logged (HY-43, HY-66). Every response limits framing (HY-45), every failure is not cacheable (HY-65), and
     * every response is reported to onResponse with the milliseconds since `$started`, an hrtime(true) value of the
     * monotonic clock that defaults to now (HY-60).
     */
    public function handle(Request $request, SessionStore $store, ?int $started = null): Response
    {
        return $this->through($request, $store, $started ?? hrtime(true), null);
    }

    /**
     * Answers a request through the request hook `around` (HY-97) and the application: `around` is null or it receives
     * the request and an `answer` function; each call of `answer` answers its request with a reply of its own, which
     * `$delivery` keeps with that request for the disconnect hook (HY-67). An error of `around` and a return value that
     * is no response are escaped errors (HY-60).
     */
    private function through(Request $request, SessionStore $store, int|float $started, ?Delivery $delivery): Response
    {
        $answer = function (Request $given) use ($store, $started, $delivery): Response {
            $reply = new Reply();
            // HY-67: the request and the reply are kept before the answer runs, so that the disconnect hook receives
            // them also when the script ends during the answer.
            if ($delivery !== null) {
                $delivery->request = $given;
                $delivery->reply = $reply;
            }

            return $this->respondWith($given, $store, $started, $reply);
        };
        if ($this->around === null) {
            return $answer($request);
        }
        $response = ($this->around)($request, $answer);
        if (!$response instanceof Response) {
            throw new \UnexpectedValueException('around returned ' . get_debug_type($response) . ', not a Response');
        }

        return $response;
    }

    /**
     * Answers one request as `handle` does and returns the response with the reply of the request, which the loaders
     * and actions of the request received (HY-60, HY-67). `$started` is an hrtime(true) value, which is a float where
     * an integer of the platform cannot hold it.
     *
     * @internal
     *
     * @return array{0: Response, 1: Reply}
     */
    public function respond(Request $request, SessionStore $store, int|float $started): array
    {
        $reply = new Reply();

        return [$this->respondWith($request, $store, $started, $reply), $reply];
    }

    /**
     * Answers one request with the given reply, which its loaders and actions receive, and reports the response to
     * the response hook (HY-60). The caller holds the reply while the answer runs (HY-67).
     */
    private function respondWith(Request $request, SessionStore $store, int|float $started, Reply $reply): Response
    {
        // The failure of a 500 of HY-43 or HY-66, which the hook receives (HY-60).
        $failure = null;
        try {
            // HY-74: a warning, notice or deprecation of the request becomes an exception instead of a wrong page.
            $response = WarningsGuard::run(fn (): Response => $this->dispatch($request, $store, $reply));
        } catch (\Throwable $error) {
            $failure = $this->logFailure($error);
            $response = Response::text(500, 'Internal Server Error');
        }
        $size = strlen($response->body);
        if ($size > $this->responseLimit) {
            $failure = "the response to {$request->method} {$request->path()} has {$size} bytes, "
                . "more than the response limit of {$this->responseLimit} bytes";
            error_log("hyper: {$failure}");
            $response = Response::text(500, 'Internal Server Error');
        }

        $response = $this->frame($response);
        $this->report($request, $response, $started, $reply, $failure);

        return $response;
    }

    /**
     * Calls the disconnect hook with the request, the milliseconds since `$started` and the reply of a request whose
     * client closed the connection (HY-67).
     *
     * @internal
     */
    public function disconnected(Request $request, int|float $started, Reply $reply): void
    {
        if ($this->onDisconnect !== null) {
            ($this->onDisconnect)($request, (hrtime(true) - $started) / 1e6, $reply);
        }
    }

    /**
     * Calls the response hook with a response, the milliseconds since `$started`, the reply of the request and the
     * failure of a 500 of HY-43 or HY-66, else null (HY-60).
     *
     * @internal
     */
    public function report(
        Request $request,
        Response $response,
        int|float $started,
        Reply $reply,
        ?string $failure,
    ): void {
        if ($this->onResponse !== null) {
            ($this->onResponse)($request, $response, (hrtime(true) - $started) / 1e6, $reply, $failure);
        }
    }

    /**
     * Adds the frame-ancestors policy of the application to a response (HY-45), and no-store to a failure (HY-65).
     *
     * @internal
     */
    public function frame(Response $response): Response
    {
        $response = $response->withHeader('Content-Security-Policy', "frame-ancestors {$this->frameAncestors}");

        return $response->status >= 400 ? $response->withHeader('Cache-Control', 'no-store') : $response;
    }

    /**
     * Writes the log line of an unhandled error (HY-43) and returns its failure, the message of the error, which the
     * hooks receive (HY-60, HY-99).
     *
     * @internal
     */
    public function logFailure(\Throwable $error): string
    {
        error_log(
            sprintf(
                'hyper: %s: %s in %s:%d',
                $error::class,
                $error->getMessage(),
                $error->getFile(),
                $error->getLine(),
            ),
        );

        return $error->getMessage();
    }

    /**
     * Writes hyper's plain 500 for an error that escapes the answer of the request (HY-60): the text, no-store and the
     * frame policy, as the other failures of the server. The headers that the caller set before `App::run` (`$kept`)
     * stay, and no other header does (HY-60). Headers that have been sent leave the response as it is, and the write
     * is then not complete (HY-99). The response hook receives no escaped 500 (HY-60). The caller has written the log
     * line of the error, whose failure is `$failure`.
     *
     * @param list<string> $kept
     */
    private function escaped(string $failure, Delivery $delivery, array $kept): void
    {
        $delivery->failure = $failure;
        if (headers_sent()) {
            $delivery->complete = false;

            return;
        }
        $response = $this->frame(Response::text(500, 'Internal Server Error'));
        // The output that the response buffered is dropped, so that the body of the response that it replaces does not
        // leave the server with the plain 500 (HY-60, HY-99).
        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        // The plain 500 replaces the queued response, which a fatal error or the session may have changed (HY-60).
        $response->sendReplacing($kept, 'HTTP/1.1 500 Internal Server Error');
        $delivery->response = $response;
    }

    /** Answers a request; the loaders and actions of a routed request receive `$reply` (HY-52, HY-60). */
    private function dispatch(Request $request, SessionStore $store, Reply $reply): Response
    {
        // HY-131.11: a body that passed the value limit, the part limit or the file limit is answered as a body over
        // the body limit.
        $streams = in_array('multipart/form-data', $this->formTypes, true);
        if (
            $request->bodySize() > $this->bodyLimit
            || $request->exceeded($this->valueLimit, $this->partLimit, $this->fileLimit, $streams)
        ) {
            return Response::text(413, 'Content Too Large');
        }
        if (!$request->validInput()) {
            return Response::text(400, 'Bad Request');
        }
        // HY-27.4: a HEAD request is answered as the GET request of its target.
        if ($request->method === 'HEAD') {
            return $this->dispatch($request->asGet(), $store, $reply);
        }
        $choice = $this->clientChoice($request);
        $client = $choice?->chosen === true ? $this->client : null;
        $request = $request->withSelection($choice?->value);
        $basePath = $client === null ? $this->basePath : $client->basePath;
        $path = Router::stripBasePath($request->path(), $basePath);
        if ($client !== null && $path === null) {
            return $this->shellResponse($request);
        }
        if ($path === '/_hyper/keep') {
            return $this->storeKept($request, new Session($store));
        }
        $match = $path === null ? null : $this->manifest->router->match($path);
        if ($match === null) {
            return Response::text(404, 'Not Found');
        }
        $route = $this->manifest->routes[$match['name']];
        $handler = $this->routeHandlers[$route['name']] ?? [];
        // HY-116: the selection runs after the routing and before the method check; the data base path serves the
        // JSON and the representations of the route (HY-116.14).
        $chosen = self::negotiate(
            $request,
            $client === null ? [self::PAGE_TYPE, self::DATA_TYPE] : [self::DATA_TYPE],
            $route['representations'],
        );
        if ($chosen instanceof Response) {
            return $chosen;
        }
        [$selected, $entry, $values] = $chosen;
        if ($entry !== null) {
            // HY-120, HY-121: a representation request opens no session and runs only its handler.
            return $this->answerRepresentation(
                $request->withRoute((string) $path, $match['params']),
                $handler,
                $entry,
                $values,
                $basePath,
            );
        }
        // HY-116: the method check of the selected type comes before the refusals of HY-62 and HY-127.
        if ($request->method !== 'GET' && ($request->method !== 'POST' || !isset($handler['post']))) {
            return self::notAllowed(isset($handler['post']) ? 'GET, HEAD, POST' : 'GET, HEAD');
        }
        // HY-62: the data base path answers only JSON requests and actions, before the session is read.
        if ($client !== null && $selected === self::PAGE_TYPE) {
            return self::notAcceptable();
        }
        // HY-127: the Hyper-Context header is checked before the session, the token check and every handler.
        if ($this->context !== null && !Context::validHeader($request->header('Hyper-Context'))) {
            return Response::text(400, 'Bad Request');
        }
        $session = new Session($store);
        $flash = $session->takeFlash();
        $request = $request->withMedia($selected)->withRoute((string) $path, $match['params'])->withSession(
            $flash,
            Csrf::masked($session->csrfToken()),
        );

        return $this->routed($request, $route, $handler, $session, $flash, $reply, $basePath)->withCookies(
            $reply,
            $this->https || $request->https,
        );
    }

    /** Returns the choice of the client rendering selection for the request, or null without client rendering (HY-62). */
    private function clientChoice(Request $request): ?Choice
    {
        if ($this->client === null) {
            return null;
        }
        $choice = ($this->client->selects)($request);
        if (!$choice instanceof Choice) {
            throw new \LogicException('the selection of the client rendering did not return a Choice');
        }

        return $choice;
    }

    /** Answers a client-rendered request outside the data base path: the static shell for a page (HY-62). */
    private function shellResponse(Request $request): Response
    {
        $match = $this->manifest->router->match($request->path());
        if ($match === null) {
            return Response::text(404, 'Not Found');
        }
        if ($request->method !== 'GET') {
            return self::notAllowed('GET, HEAD');
        }
        // HY-62 step 3: the path serves only text/html, so a request that selects the JSON receives 406. The
        // representations of the route take part in the selection, so that a request that selects one of them is not
        // acceptable here, and they are not listed (HY-116.14).
        try {
            $selected = MediaSelection::select(
                $request->header('Accept'),
                [self::PAGE_TYPE, self::DATA_TYPE],
                $this->manifest->routes[$match['name']]['representations'],
            );
        } catch (InvalidAccept) {
            return Response::text(400, 'Bad Request')->withHeader('Vary', 'Accept');
        }
        if ($selected === null) {
            return Response::text(406, MediaSelection::listing([self::PAGE_TYPE], []))->withHeader('Vary', 'Accept');
        }
        if ($selected[0] !== self::PAGE_TYPE) {
            return self::notAcceptable();
        }

        return new Response(
            200,
            [
                'Content-Type' => 'text/html; charset=utf-8',
                'Cache-Control' => 'no-cache',
                'Vary' => $this->varyHeader(),
            ],
            $this->shell,
        );
    }

    /** Returns the Vary of a response with text/html or application/vnd.hyper+json (HY-117). */
    private function varyHeader(): string
    {
        return 'Accept, HX-Request, HX-Current-URL' . ($this->context === null ? '' : ', Hyper-Context');
    }

    /**
     * Selects the media type of a request among text/html, application/vnd.hyper+json and the representations of
     * its route (HY-116), or returns the refusal of the request: 400 for an Accept that does not follow the grammar,
     * and 406 for a request that matches none of the types, which lists the `$served` types and the entries, one on
     * each line.
     *
     * @param list<string> $served the page types that the path serves
     * @param list<RepresentationEntry> $entries
     * @return array{0: string, 1: ?RepresentationEntry, 2: array<array-key, string>}|Response
     */
    private static function negotiate(Request $request, array $served, array $entries): array|Response
    {
        try {
            $selected = MediaSelection::select(
                $request->header('Accept'),
                [self::PAGE_TYPE, self::DATA_TYPE],
                $entries,
            );
        } catch (InvalidAccept) {
            return Response::text(400, 'Bad Request')->withHeader('Vary', 'Accept');
        }

        return $selected
            ?? Response::text(406, MediaSelection::listing($served, $entries))->withHeader('Vary', 'Accept');
    }

    /**
     * Answers a representation request (HY-121, HY-122): the method check, the body checks, the handler of the
     * entry, and the response of what it returned with its tag.
     *
     * @param RouteHandler $handler
     * @param array<array-key, string> $values
     */
    private function answerRepresentation(
        Request $request,
        array $handler,
        RepresentationEntry $entry,
        array $values,
        string $basePath,
    ): Response {
        $vary = implode(', ', ['Accept', ...$entry->vary]);
        $method = $request->method;
        if (!in_array($method, $entry->methods, true)) {
            // HY-121.6: an entry with GET also answers HEAD, which reaches here as GET (HY-27.4).
            $answered = array_filter(
                ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'],
                static fn (string $name): bool => in_array(
                    $name === 'HEAD' ? 'GET' : $name,
                    $entry->methods,
                    true,
                ),
            );

            return self::notAllowed(implode(', ', $answered))->withHeader('Vary', $vary);
        }
        $value = null;
        if (in_array($method, ['GET', 'DELETE'], true)) {
            if ($request->bodySize() !== 0) {
                return Response::text(400, 'Bad Request')->withHeader('Vary', $vary);
            }
        } else {
            if ($request->mediaType() !== 'application/json') {
                return Response::text(415, 'Unsupported Media Type')->withHeader('Vary', $vary);
            }
            try {
                $value = JsonCodec::decode($request->bodyBytes());
            } catch (JsonDecodeError) {
                return Response::text(400, 'Bad Request')->withHeader('Vary', $vary);
            }
            // HY-121.8: a number outside the data model is no value that a handler reads.
            if (!JsonCodec::inDataModel($value)) {
                return Response::text(400, 'Bad Request')->withHeader('Vary', $vary);
            }
        }
        $contentType = MediaSelection::contentType($entry, $values);
        $handle = $handler['representations'][$entry->type]
            ?? throw new \LogicException("the route has no representation handler for {$entry->type} (HY-118)");
        try {
            $returned = $this->container->call($handle, [
                Request::class => $request->asRepresentation($value),
                MediaType::class => new MediaType($values, $contentType),
            ]);
        } catch (\Throwable $error) {
            // HY-107: an error of the ORM is known by its class name and code.
            return match (self::ormCode($error)) {
                'NO_ROWS' => Response::text(404, 'Not Found')->withHeader('Vary', $vary),
                'REVISION_CHANGED' => Response::text(412, 'Precondition Failed')->withHeader('Vary', $vary),
                default => throw $error,
            };
        }
        $response = RepresentationResponse::of(
            $returned,
            $contentType,
            $vary,
            $request->header('Authorization') !== null,
            $basePath,
        );
        if ($response->status !== 200 || $method !== 'GET') {
            return $response;
        }
        // HY-122.10: a 200 of a GET, as which a HEAD is answered, has a strong tag, and a request that names it
        // receives 304.
        $tag = RepresentationResponse::etag($contentType, $response->body);
        $response = $response->withHeader('ETag', $tag);
        if ($request->header('If-None-Match') !== $tag) {
            return $response;
        }
        $headers = $response->headers;
        unset($headers['Content-Type']);

        return new Response(304, $headers, '');
    }

    /** Returns the 405 of a method that a target does not take, with the methods that it takes (HY-27.6). */
    private static function notAllowed(string $allow): Response
    {
        return Response::text(405, 'Method Not Allowed')->withHeader('Allow', $allow);
    }

    /** Returns the 406 of a selected type that the path does not serve (HY-62 steps 2 and 3). */
    private static function notAcceptable(): Response
    {
        return Response::text(406, 'Not Acceptable')->withHeader('Vary', 'Accept');
    }

    /**
     * Answers a routed request with its page, action result or stop result.
     *
     * @param RouteDefinition $route
     * @param RouteHandler $handler
     */
    private function routed(
        Request $request,
        array $route,
        array $handler,
        Session $session,
        Flash $flash,
        Reply $reply,
        string $basePath,
    ): Response {
        try {
            if ($request->method === 'GET') {
                return self::withoutRenewal(
                    $reply,
                    $this->page->respond($request, $route, $handler, $session, $flash, 200, [], $reply, $basePath),
                );
            }
            if ($request->method !== 'POST' || !isset($handler['post'])) {
                return self::notAllowed(isset($handler['post']) ? 'GET, HEAD, POST' : 'GET, HEAD');
            }
            $refused = $this->refusedForm($request, $session);
            if ($refused !== null) {
                return $refused;
            }
            // HY-114: a file over the file limit is refused before the action runs, as HY-59 refuses a large body.
            if ($request->fileOver($this->fileLimit)) {
                return Response::text(413, 'Content Too Large');
            }
            try {
                $result = $this->container->call(
                    $handler['post'],
                    [Request::class => $request, Reply::class => $reply],
                );
            } catch (\Throwable $error) {
                // HY-107.4: only an action that raises REVISION_CHANGED is answered as the page with status 409;
                // the loaders of that page are loaders, so their renewal (HY-72.4) and their REVISION_CHANGED fail.
                if (self::ormCode($error) !== 'REVISION_CHANGED') {
                    throw $error;
                }
                $result = Result::page(409, []);
            }
            if (!$result instanceof Result) {
                throw new \LogicException("POST action of route {$route['name']} did not return a Result");
            }
            // HY-72: the action renews the session after it returns, and a page that it renders carries the new token.
            if ($reply->takeRenewal()) {
                $session->renew();
                $request = $request->withSession($flash, Csrf::masked($session->csrfToken()));
            }
            if ($result->isRedirect()) {
                return $this->redirectResponse($session, $result, $basePath);
            }

            return self::withoutRenewal(
                $reply,
                $this->page->respond(
                    $request,
                    $route,
                    $handler,
                    $session,
                    $flash,
                    $result->status,
                    $result->data,
                    $reply,
                    $basePath,
                ),
            );
        } catch (NotFound) {
            return Response::text(404, 'Not Found');
        } catch (Redirect $redirect) {
            return $this->redirectResponse($session, $redirect->result, $basePath);
        } catch (Forbidden) {
            return Response::text(403, 'Forbidden');
        } catch (BadRequest) {
            return Response::text(400, 'Bad Request');
        } catch (\Throwable $error) {
            // HY-107: an error of the ORM is answered as the stop of its meaning; every other error escapes (HY-43).
            // HY-107.4: a loader that raises REVISION_CHANGED escapes; the action's one is answered above.
            return match (self::ormCode($error)) {
                'NO_ROWS' => Response::text(404, 'Not Found'),
                default => throw $error,
            };
        }
    }

    /**
     * The code of an error of the ORM, which hyper knows by the name of its class and by its property `code_`,
     * because it does not depend on the ORM (HY-107), or null for every other error.
     */
    private static function ormCode(\Throwable $error): ?string
    {
        $class = new \ReflectionClass($error);
        if ($class->getShortName() !== 'OrmException' || !$class->hasProperty('code_')) {
            return null;
        }
        $code = $class->getProperty('code_')->getValue($error);

        return is_string($code) ? $code : null;
    }

    /** Fails when a loader or the shared handler renewed the session, because the page carries the old token (HY-72). */
    private static function withoutRenewal(Reply $reply, Response $response): Response
    {
        if ($reply->takeRenewal()) {
            throw new \LogicException(
                'a loader or the shared handler called renewSession; only an action renews the session',
            );
        }

        return $response;
    }

    /** Stores the flash values and changed topics of a redirect result and answers 303 (HY-25, HY-50). */
    private function redirectResponse(Session $session, Result $result, string $basePath): Response
    {
        $session->putFlash(new Flash($result->flashValues, $result->changedTopics));

        return new Response(303, ['Location' => $basePath . $result->location], '');
    }

    /** The response that refuses a form request of an unsupported media type or with a wrong CSRF token, or null. */
    private function refusedForm(Request $request, Session $session): ?Response
    {
        if (!in_array($request->mediaType(), $this->formTypes, true)) {
            return Response::text(415, 'Unsupported Media Type');
        }
        if (!Csrf::verify($session->csrfToken(), $request->formString('_csrf'))) {
            return Response::text(403, 'Forbidden');
        }

        return null;
    }

    /** Stores a kept value of a `server` path in the session (HY-40). */
    private function storeKept(Request $request, Session $session): Response
    {
        if ($request->method !== 'POST') {
            return self::notAllowed('POST');
        }
        $refused = $this->refusedForm($request, $session);
        if ($refused !== null) {
            return $refused;
        }
        if ($request->fileOver($this->fileLimit)) {
            return Response::text(413, 'Content Too Large');
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
            $value = JsonCodec::decode($text);
        } catch (JsonDecodeError) {
            return Response::text(400, 'Bad Request');
        }
        if (!JsonCodec::inDataModel($value)) {
            return Response::text(400, 'Bad Request');
        }
        $session->keep($name, $path, $value);

        return new Response(204, [], '');
    }

    /**
     * Answers the current PHP request with the PHP session and writes the response; errors go to the log, and an error
     * that escapes the answer gets the plain 500 of HY-60.
     * A response without a body receives no Content-Type from PHP (HY-52), and a client that closed the connection
     * ends the script at the first failed write and is reported to the disconnect hook (HY-67). The elapsed time of
     * HY-60 counts from `$started`, an hrtime(true) value of the monotonic clock that the caller takes at the start
     * of the request, such as the first statement of its front controller, and that defaults to now.
     */
    public function run(?int $started = null): void
    {
        // The headers that the caller set before this call stay on the plain 500 of an escaped error (HY-60).
        $kept = headers_list();
        $started ??= hrtime(true);
        // HY-59: PHP drops a body larger than post_max_size, gives the body of a multipart request to php://input only
        // when enable_post_data_reading is off, and with it on reads every body with its own reader before the
        // application, under every SAPI that serves requests.
        $postMaxSize = ini_parse_quantity((string) ini_get('post_max_size'));
        if ($postMaxSize > 0 && $postMaxSize < $this->bodyLimit) {
            throw new \LogicException("body limit {$this->bodyLimit} is larger than post_max_size {$postMaxSize}");
        }
        if (
            in_array('multipart/form-data', $this->formTypes, true)
            && filter_var(ini_get('enable_post_data_reading'), FILTER_VALIDATE_BOOL)
        ) {
            throw new \LogicException('multipart/form-data is accepted, so enable_post_data_reading must be off');
        }
        if (
            !in_array(PHP_SAPI, ['cli', 'phpdbg'], true)
            && filter_var(ini_get('enable_post_data_reading'), FILTER_VALIDATE_BOOL)
        ) {
            throw new \LogicException(
                'enable_post_data_reading must be off: with it on PHP reads a request body before the application',
            );
        }
        ini_set('display_errors', '0');
        ini_set('log_errors', '1');
        ini_set('default_mimetype', '');
        // HY-67: PHP reports a closed connection only at a failed write; with ignore_user_abort off it ends the
        // script there, and the shutdown function calls the disconnect hook.
        ignore_user_abort(false);
        $delivery = new Delivery();
        // HY-60: an uncaught exception and a fatal error of the request write the plain 500 of hyper, the same as the
        // other servers, instead of the web server's 500. The request is known once it is built.
        set_exception_handler(function (\Throwable $error) use ($delivery, $kept): void {
            $this->escaped($this->logFailure($error), $delivery, $kept);
        });
        register_shutdown_function(function () use ($delivery, $kept): void {
            $error = error_get_last();
            if ($error !== null && in_array($error['type'], self::FATAL, true)) {
                // HY-43: a fatal error is no exception, so its log line is written here.
                error_log("hyper: fatal error: {$error['message']} in {$error['file']}:{$error['line']}");
                $this->escaped($error['message'], $delivery, $kept);
            }
        });
        // HY-131: a multipart body of an application with that form type is read in chunks into files of the request.
        $request = Request::fromGlobals(
            $this->bodyLimit,
            in_array('multipart/form-data', $this->formTypes, true),
            $this->valueLimit,
            $this->partLimit,
            $this->fileLimit,
        );
        // HY-99: the write hook runs after the escape function and before the disconnect hook. A response that no write
        // started is the plain 500, and its write is not complete.
        if ($this->written !== null) {
            $hook = $this->written;
            register_shutdown_function(static function () use ($hook, $request, $started, $delivery): void {
                // HY-99: a request that ended before a response started has no response; its write did not end.
                $ended = $delivery->response !== null && $delivery->complete && connection_aborted() !== 1;
                $hook($request, $delivery->response, $ended, (hrtime(true) - $started) / 1e6, $delivery->failure);
            });
        }
        if ($this->onDisconnect !== null) {
            register_shutdown_function(function () use ($started, $delivery): void {
                // HY-97: the request and the reply of the last call of `answer`; none when `around` never called it.
                if ($delivery->request !== null && $delivery->reply !== null && connection_aborted() === 1) {
                    $this->disconnected($delivery->request, $started, $delivery->reply);
                }
            });
        }
        // HY-131.14: the files of the request are removed after the hooks above, which run first, also for a request
        // that fails or whose client closed the connection.
        register_shutdown_function(static function () use ($request): void {
            $request->release();
        });
        $response = $this->through($request, new NativeSession($this->https, $request, $this->sessionSetup), $started, $delivery);
        $delivery->response = $response;
        $response->send();
    }
}
