<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

use Polyspec\Template\BoundMap;

/**
 * Renders the page of a route as a document or as JSON, with the data of its loaders and the kept values (HY-10 to
 * HY-19, HY-31, HY-38, HY-44, HY-53, HY-73, HY-75, HY-92, HY-124, HY-128).
 *
 * @internal
 *
 * @phpstan-import-type RouteDefinition from Manifest
 * @phpstan-import-type RouteHandler from App
 */
final class Page
{
    /** The media type of a JSON response (HY-15, HY-116). */
    private const DATA_TYPE = 'application/vnd.hyper+json';

    /**
     * @internal
     *
     * @param ?\Closure $shared the shared handler, or null without one
     * @param array<string, \Closure> $regionLoaders the loaders of the regions that are no route regions
     * @param string $build the build id of the application, which every JSON response holds (HY-125, HY-128)
     * @param ?\Closure $context the context handler (HY-124), or null without one
     * @param string $vary the Vary of a response with text/html or application/vnd.hyper+json (HY-117)
     */
    public function __construct(
        private readonly Manifest $manifest,
        private readonly ?\Closure $shared,
        private readonly array $regionLoaders,
        private readonly Container $container,
        private readonly Renderer $renderer,
        private readonly Reads $reads,
        private readonly string $build,
        private readonly string $timezone,
        private readonly bool $https,
        private readonly ?\Closure $context,
        private readonly string $vary,
    ) {
    }

    /**
     * Renders the route page as a document or as JSON.
     *
     * @param RouteDefinition $route
     * @param RouteHandler $handler
     * @param array<array-key, mixed> $invalid
     *
     * @internal
     */
    public function respond(
        Request $request,
        array $route,
        array $handler,
        Session $session,
        Flash $flash,
        int $status,
        array $invalid,
        Reply $reply,
        string $basePath,
    ): Response {
        $json = $request->wantsJson();
        $provided = [Request::class => $request, Reply::class => $reply];
        $shared = ['title' => $route['title'], 'csrf' => $request->csrfToken()];
        // HY-124: the context handler runs after the action and before the shared handler and any loader.
        $context = $this->context === null ? null : Context::held($this->context, $request->selection());
        if ($this->shared !== null) {
            $returned = self::loaderMap($this->container->call($this->shared, $provided), 'the shared handler');
            if (array_key_exists('context', $returned)) {
                throw new \LogicException('the shared handler returned the key context (HY-124)');
            }
            $shared = array_replace($shared, $returned);
        }

        $changed = RegionPlanner::changedTopics($request, $flash, $basePath);
        $data = [];
        $templates = [];
        foreach (RegionPlanner::select($this->manifest, !$request->isRegionRequest(), $changed) as $selected) {
            if ($selected->page) {
                $loaded = isset($handler['load']) ? self::loaderMap(
                    $this->container->call($handler['load'], $provided),
                    "the loader of route {$route['name']}",
                ) : [];
                $data[$selected->name] = array_replace($loaded, $invalid);
                $templates[$selected->name] = $route['template'];
                foreach ($route['regions'] as $routeRegion) {
                    $loader = $handler['regions'][$routeRegion->name] ?? null;
                    $loaded = $loader === null ? [] : $this->container->call($loader, $provided);
                    // HY-75: a route region loader that returns null makes the region absent from this response.
                    if ($loaded === null) {
                        continue;
                    }
                    $data[$routeRegion->name] = self::loaderMap($loaded, "the loader of region {$routeRegion->name}");
                    $templates[$routeRegion->name] = (string) $routeRegion->template;
                }
            } else {
                $loader = $this->regionLoaders[$selected->name] ?? null;
                $data[$selected->name] = $loader === null ? [] : self::loaderMap(
                    $this->container->call($loader, $provided),
                    "the loader of region {$selected->name}",
                );
                $templates[$selected->name] = (string) $selected->template;
            }
        }

        // HY-44: every value that the handlers returned belongs to the data model, also a value that no template reads.
        DataModel::check(['shared' => $shared, 'regions' => $data]);
        // HY-73: the page keeps only the paths that the templates of the route read.
        $shared = $this->reads->shared($route['name'], $shared);
        foreach ($data as $name => $regionData) {
            $data[$name] = $this->reads->region($route['name'], $name, $regionData);
        }
        $kept = $this->kept($request, $session, $data);
        // HY-69: the reply gives a page with status 200 the status 403.
        if ($status === 200 && $reply->statusValue() !== null) {
            $status = $reply->statusValue();
        }
        if ($json) {
            // HY-128: the member context holds the hash, and the value unless the request holds that hash (HY-127).
            $member = $context === null
                ? null
                : Context::member($this->build, $context, $request->header('Hyper-Context'));
            $response = JsonCodec::value(
                $this->timezone,
                $route['name'],
                $request->params(),
                $this->build,
                $member,
                $shared,
                $data,
                $kept,
            );
            // HY-44: the check above covered the handler data, and a kept value enters only when it belongs to the
            // data model, so only the parameters of the request are checked here.
            DataModel::check($request->params());

            $body = JsonCodec::encode($response);
            $headers = [
                'Content-Type' => self::DATA_TYPE,
                'Cache-Control' => $status === 200 ? ($reply->cacheControlValue() ?? 'no-store') : 'no-store',
                'Vary' => $this->vary,
                ...$reply->referrerPolicyHeaders(),
            ];
            if ($status !== 200) {
                return new Response($status, $headers, $body);
            }
            // HY-53: a weak tag of the body with the masked token replaced by the session token, so the mask does not
            // change it; a matching GET request receives 304 without a body and without `Content-Type`, because a
            // 304 carries no representation.
            $hash = hash('sha256', str_replace($request->csrfToken(), $session->csrfToken(), $body));
            $tag = 'W/"' . substr($hash, 0, 32) . '"';
            $headers['ETag'] = $tag;
            if ($request->method !== 'GET' || $request->header('If-None-Match') !== $tag) {
                return new Response(200, $headers, $body);
            }
            unset($headers['Content-Type']);

            return new Response(304, $headers, '');
        }

        $headers = [
            'Content-Type' => 'text/html; charset=utf-8',
            'Cache-Control' => $status === 200 ? ($reply->cacheControlValue() ?? 'no-store') : 'no-store',
            'Vary' => $this->vary,
            ...$reply->referrerPolicyHeaders(),
        ];

        return new Response(
            $status,
            $headers,
            $this->document($request, $route, $shared, $context, $data, $templates, $kept, $reply->embedsData()),
        );
    }

    /**
     * Returns the value that the shared handler or a loader returned when it is a map of the data model: an array that
     * is empty or is not a list (HY-44). Another value fails with HY-43.
     *
     * @return array<array-key, mixed>
     */
    private static function loaderMap(mixed $value, string $source): array
    {
        if (!is_array($value) || ($value !== [] && array_is_list($value))) {
            throw new \LogicException("{$source} did not return a map");
        }

        return $value;
    }

    /**
     * Returns the conforming `server` and `cookie` kept values of the regions, by region and path (HY-17, HY-38).
     *
     * @param array<string, array<array-key, mixed>> $data
     * @return array<string, array<string, mixed>>
     */
    private function kept(Request $request, Session $session, array $data): array
    {
        // On HTTPS only the host-only cookie counts, which another host cannot set (HY-38).
        $cookie = self::decodedCookie($request->cookie($this->https || $request->https ? '__Host-hy-keep' : 'hy-keep'));
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
                    'cookie' => $cookie instanceof \stdClass && ($cookie->{$name} ?? null) instanceof \stdClass
                        ? get_object_vars($cookie->{$name})
                        : [],
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
     * the embedded data (HY-31, HY-38). The document embeds its data only when `$embed` is true (HY-92).
     *
     * @param RouteDefinition $route
     * @param array<array-key, mixed> $shared
     * @param array<array-key, mixed>|null $context the context of the application, or null without one (HY-124)
     * @param array<string, array<array-key, mixed>> $data
     * @param array<string, string> $templates
     * @param array<string, array<string, mixed>> $kept
     */
    private function document(
        Request $request,
        array $route,
        array $shared,
        ?array $context,
        array $data,
        array $templates,
        array $kept,
        bool $embed,
    ): string {
        // H10.4: each root of the document is bound once, and every render merges the bound roots (VAL-22).
        // HY-10, HY-124: the templates read the context in the shared data, in its place after csrf or title.
        $boundShared = $this->renderer->bind($context === null ? $shared : Context::withContext($shared, $context));
        $applied = [];
        foreach ($data as $name => $regionData) {
            $pairs = [];
            foreach ($kept[$name] ?? [] as $path => $value) {
                $pairs[] = [$path, $value];
            }
            $applied[$name] = $this->renderer->bind(Kept::apply($regionData, $pairs));
        }
        try {
            return $this->renderDocument(
                $request,
                $route,
                $shared,
                $context,
                $boundShared,
                $data,
                $applied,
                $templates,
                $kept,
                $embed,
            );
        } catch (\Throwable $error) {
            if ($kept === []) {
                throw $error;
            }
        }
        $page = $this->manifest->page->name;
        $routeRegions = self::present($route, $data);
        $others = array_values(array_diff(array_keys($data), [...$routeRegions, $page]));
        foreach ([...$routeRegions, ...$others, $page] as $name) {
            if (!isset($kept[$name])) {
                continue;
            }
            try {
                $define = [];
                if ($name === $page) {
                    foreach ($routeRegions as $routeRegion) {
                        $define[$routeRegion] = [
                            'template' => $templates[$routeRegion],
                            'data' => $applied[$routeRegion],
                        ];
                    }
                }
                $this->renderer->alone($templates[$name], $boundShared, $applied[$name], $define);
            } catch (\Throwable) {
                $applied[$name] = $this->renderer->bind($data[$name]);
                unset($kept[$name]);
            }
        }

        return $this->renderDocument(
            $request,
            $route,
            $shared,
            $context,
            $boundShared,
            $data,
            $applied,
            $templates,
            $kept,
            $embed,
        );
    }

    /**
     * Returns the names of the route regions of a route that are present in the data (HY-75).
     *
     * @param RouteDefinition $route
     * @param array<string, array<array-key, mixed>> $data
     * @return list<string>
     */
    private static function present(array $route, array $data): array
    {
        return array_values(
            array_filter(
                array_map(fn (Region $region): string => $region->name, $route['regions']),
                fn (string $name): bool => array_key_exists($name, $data),
            ),
        );
    }

    /**
     * @param RouteDefinition $route
     * @param array<array-key, mixed> $shared shared data, which the embedded data carries
     * @param array<array-key, mixed>|null $context the context of the application, or null without one (HY-124)
     * @param array<string, array<array-key, mixed>> $data loader data, which the embedded data carries
     * @param array<string, BoundMap> $applied bound region data with kept values applied, which the
     *     regions render
     * @param array<string, string> $templates
     * @param array<string, array<string, mixed>> $kept
     * @param bool $embed whether the reply asked the document to embed its data (HY-92)
     */
    private function renderDocument(
        Request $request,
        array $route,
        array $shared,
        ?array $context,
        BoundMap $boundShared,
        array $data,
        array $applied,
        array $templates,
        array $kept,
        bool $embed,
    ): string {
        // HY-31, HY-75, HY-92: a document embeds its data only when the reply asks for it, and then only the present
        // route regions and their kept entries, the data that the browser can change; a response without a present
        // route region embeds none. The embedded data is one more root, bound once (H10.4).
        $routeRegionNames = self::present($route, $data);
        $response = null;
        if ($embed && $routeRegionNames !== []) {
            $embedded = array_intersect_key($data, array_flip($routeRegionNames));
            // HY-31: an embedded document holds build and context with its value, whatever the request holds.
            $member = $context === null ? null : Context::member($this->build, $context, null);
            $response = JsonCodec::value(
                $this->timezone,
                $route['name'],
                $request->params(),
                $this->build,
                $member,
                $shared,
                $embedded,
                array_intersect_key($kept, $embedded),
            );
        }
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

        return $this->renderer->document(
            $this->manifest->layout,
            $this->manifest->title,
            $boundShared,
            $regions,
            $this->manifest->page->name,
            $routeRegions,
            $response === null ? null : $this->renderer->bind(['response' => $response]),
            $this->build,
        );
    }

    /** Returns the decoded hy-keep cookie, or null for a cookie that is absent or not JSON (HY-42). */
    private static function decodedCookie(?string $text): mixed
    {
        if ($text === null) {
            return null;
        }
        try {
            return JsonCodec::decode($text);
        } catch (JsonDecodeError) {
            return null;
        }
    }
}
