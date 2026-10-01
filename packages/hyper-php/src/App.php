<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

use Polyspec\Template\Value\Bind;

/** Answers requests with documents, JSON and action redirects (HY-8, HY-10 to HY-19, HY-24 to HY-27). */
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
        string $templates,
    ) {
        $this->container = new Container();
        $this->renderer = new Renderer($templates, $timezone);
    }

    /**
     * Creates an application from its manifest, its templates and the handlers that load data and run actions.
     *
     * @param array{shared?: \Closure, regions?: array<string, \Closure>, routes?: array<string, array{load?: \Closure, post?: \Closure, regions?: array<string, \Closure>}>} $handlers
     */
    public static function open(
        string $manifest,
        string $templates,
        array $handlers,
        string $timezone,
        string $basePath = '',
        bool $https = false,
        string $frameAncestors = "'self'",
    ): self {
        if (!is_dir($templates)) {
            throw new \InvalidArgumentException("template directory {$templates} does not exist");
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

        return new self($declared, $handlers['shared'] ?? null, $regionLoaders, $routeHandlers, $timezone, $basePath, $https, $frameAncestors, $templates);
    }

    /** Registers the factory of an application service. */
    public function bind(string $class, \Closure $factory): void
    {
        $this->container->bind($class, $factory);
    }

    /** Answers one request; an unhandled exception gives a plain 500 and is logged (HY-43). Every response limits framing (HY-45). */
    public function handle(Request $request, SessionStore $store): Response
    {
        try {
            $response = $this->answer($request, $store);
        } catch (\Throwable $error) {
            error_log(sprintf('hyper: %s: %s in %s:%d', $error::class, $error->getMessage(), $error->getFile(), $error->getLine()));
            $response = Response::text(500, 'Internal Server Error');
        }

        return $response->withHeader('Content-Security-Policy', "frame-ancestors {$this->frameAncestors}");
    }

    private function answer(Request $request, SessionStore $store): Response
    {
        if (!$request->validUtf8()) {
            return Response::text(400, 'Bad Request');
        }
        $path = Router::stripBasePath($request->path, $this->basePath);
        if ($path === '/_hyper/keep') {
            return $this->keep($request, new Session($store));
        }
        $match = $path === null ? null : $this->manifest->router->match($path);
        if ($match === null) {
            return Response::text(404, 'Not Found');
        }
        $route = $this->manifest->routes[$match['name']];
        $handler = $this->routeHandlers[$route['name']] ?? [];
        $region = $request->wantsJson() ? $request->region() : null;
        if ($region !== null && $region !== $this->manifest->page->name) {
            return Response::text(400, 'Bad Request');
        }
        $session = new Session($store);
        $flash = $session->takeFlash();
        $request = $request->withRoute((string) $path, $match['params'])->withSession($flash, $session->csrfToken());

        try {
            if ($request->method === 'GET') {
                return $this->page($request, $route, $handler, $session, $flash, 200, []);
            }
            if ($request->method !== 'POST' || !isset($handler['post'])) {
                return Response::text(405, 'Method Not Allowed');
            }
            if (!hash_equals($request->csrfToken(), $request->formString('_csrf'))) {
                return Response::text(403, 'Forbidden');
            }
            $result = $this->container->call($handler['post'], [Request::class => $request]);
            if (!$result instanceof Result) {
                throw new \LogicException("POST action of route {$route['name']} did not return a Result");
            }
            if ($result->isRedirect()) {
                $session->putFlash(new Flash($result->flash, $result->changed));

                return new Response(303, ['Location' => $this->basePath . $result->location], '');
            }

            return $this->page($request, $route, $handler, $session, $flash, 422, $result->data);
        } catch (NotFound) {
            return Response::text(404, 'Not Found');
        }
    }

    /**
     * Renders the route page as a document or as JSON.
     *
     * @param array{name: string, path: string, title: string, template: string, post: bool, regions: list<Region>} $route
     * @param array{load?: \Closure, post?: \Closure, regions?: array<string, \Closure>} $handler
     * @param array<string, mixed> $invalid
     */
    private function page(Request $request, array $route, array $handler, Session $session, Flash $flash, int $status, array $invalid): Response
    {
        $json = $request->wantsJson();
        $region = $json ? $request->region() : null;
        $provided = [Request::class => $request];
        $shared = ['title' => $route['title'], 'csrf' => $request->csrfToken()];
        if ($this->shared !== null) {
            $shared = array_replace($shared, $this->container->call($this->shared, $provided));
        }

        $changed = RegionPlanner::changedTopics($request, $flash, $this->basePath);
        $data = [];
        $templates = [];
        foreach (RegionPlanner::select($this->manifest, !$json || $region === null, $changed) as $selected) {
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

        $cookie = json_decode($request->cookie('hy-keep') ?? '');
        foreach ($data as $name => $regionData) {
            $region = $this->manifest->region($name);
            if ($region === null) {
                continue;
            }
            $stored = $session->kept($name);
            $kept = [];
            foreach ($region->keep as $keptPath => $kind) {
                $values = match ($kind) {
                    'server' => $stored,
                    'cookie' => $cookie instanceof \stdClass && ($cookie->{$name} ?? null) instanceof \stdClass ? get_object_vars($cookie->{$name}) : [],
                    default => [],
                };
                if (array_key_exists($keptPath, $values)) {
                    $kept[] = [$keptPath, $values[$keptPath]];
                }
            }
            $data[$name] = Kept::apply($regionData, $kept);
        }

        $response = JsonEncoder::value($this->timezone, $route['name'], $request->params(), $shared, $data);
        // HY-44: every value must belong to the template data model, for JSON as for a document.
        Bind::value($response);
        $vary = 'Accept, Hy-Region, HX-Current-URL';
        if ($json) {
            return new Response($status, [
                'Content-Type' => 'application/json; charset=utf-8',
                'Cache-Control' => 'no-store',
                'Vary' => $vary,
            ], JsonEncoder::encode($response));
        }

        $regions = [];
        foreach ($data as $name => $regionData) {
            $regions[$name] = ['template' => $templates[$name], 'data' => $regionData];
        }

        return new Response($status, [
            'Content-Type' => 'text/html; charset=utf-8',
            'Vary' => $vary,
        ], $this->renderer->document($this->manifest->layout, $this->manifest->title, $shared, $regions, $response));
    }

    /** Stores a kept value of a `server` path in the session (HY-40). */
    private function keep(Request $request, Session $session): Response
    {
        if ($request->method !== 'POST') {
            return Response::text(405, 'Method Not Allowed');
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

    /** Answers the current PHP request with the PHP session and writes the response; errors go to the log only. */
    public function run(): void
    {
        ini_set('display_errors', '0');
        ini_set('log_errors', '1');
        $this->handle(Request::fromGlobals(), new NativeSession($this->https))->send();
    }
}
