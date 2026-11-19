<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The application manifest: layout, title, regions and routes (HY-1, HY-2).
 *
 * @internal
 * @phpstan-type RouteDefinition array{
 *     name: string,
 *     path: string,
 *     title: string,
 *     template: string,
 *     post: bool,
 *     regions: list<Region>,
 *     representations: list<RepresentationEntry>
 * }
 */
final class Manifest
{
    /**
     * @param list<Region> $regions
     * @param array<string, RouteDefinition> $routes
     */
    private function __construct(
        public readonly array $regions,
        public readonly Region $page,
        public readonly array $routes,
        public readonly Router $router,
    ) {
    }

    /** Reads and checks a manifest file. */
    public static function fromFile(string $file): self
    {
        if (!is_file($file)) {
            throw new HyperValueError("manifest {$file} does not exist", 'invalid_application');
        }
        $data = null;
        $objects = null;
        try {
            $text = (string) file_get_contents($file);
            $data = json_decode($text, true, flags: JSON_THROW_ON_ERROR);
            // HY-2.8: the manifest is JSON text as HY-54 decodes it. The value of the core tells an empty object from
            // an empty list, which the representations of a route need (HY-118.7).
            $objects = JsonCodec::decode($text);
            $decoded = true;
        } catch (\JsonException | HyperValueError) {
            $decoded = false;
        }
        // The class of the binding takes no previous error, so the error is thrown outside the catch (HY-106.21).
        if (!$decoded) {
            throw new HyperValueError("manifest {$file} is not valid JSON or UTF-8", 'invalid_application');
        }
        if (!is_array($data) || !is_string($data['layout'] ?? null) || !is_string($data['title'] ?? null)) {
            throw new HyperValueError("manifest {$file} has no layout or title template", 'invalid_application');
        }

        $regions = [];
        $page = null;
        foreach (self::entries($data, 'regions') as $region) {
            $name = is_string($region['name'] ?? null) ? $region['name'] : '';
            if (!self::regionName($name) || isset($regions[$name])) {
                throw new HyperValueError("manifest region name {$name} is not allowed", 'invalid_application');
            }
            $isPage = ($region['page'] ?? false) === true;
            $template = $region['template'] ?? null;
            if ($isPage === is_string($template)) {
                throw new HyperValueError(
                    "manifest region {$name} must have a template unless it is the page region",
                    'invalid_application',
                );
            }
            $declaredUses = $region['uses'] ?? [];
            if (!is_array($declaredUses)) {
                throw new HyperValueError("manifest region {$name} uses an invalid topic", 'invalid_application');
            }
            foreach ($declaredUses as $topic) {
                if (!is_string($topic) || preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/D', $topic) !== 1) {
                    throw new HyperValueError("manifest region {$name} uses an invalid topic", 'invalid_application');
                }
            }
            // HY-37: only route regions change in the browser, so only they keep values.
            if (array_key_exists('keep', $region)) {
                throw new HyperValueError(
                    "manifest region {$name} cannot keep values; only route regions keep values",
                    'invalid_application',
                );
            }
            $regions[$name] = new Region($name, $isPage, is_string($template) ? $template : null);
            if ($isPage) {
                if ($page !== null) {
                    throw new HyperValueError('manifest declares more than one page region', 'invalid_application');
                }
                $page = $regions[$name];
            }
        }
        if ($page === null) {
            throw new HyperValueError('manifest declares no page region', 'invalid_application');
        }

        $routes = [];
        $regionNames = array_fill_keys(array_keys($regions), true);
        $routeObjects = JsonCodec::mapEntries($objects)['routes'] ?? null;
        $routeObjects = JsonCodec::isList($routeObjects) ? $routeObjects : [];
        foreach (self::entries($data, 'routes') as $index => $route) {
            $name = is_string($route['name'] ?? null) ? $route['name'] : '';
            $title = $route['title'] ?? null;
            $template = $route['template'] ?? null;
            $path = $route['path'] ?? null;
            if (
                $name === ''
                || isset($routes[$name])
                || !is_string($title)
                || !is_string($template)
                || !is_string($path)
            ) {
                throw new HyperValueError(
                    "manifest route {$name} is duplicated or incomplete",
                    'invalid_application',
                );
            }
            if (str_starts_with($path, '/_hyper')) {
                throw new HyperValueError(
                    "manifest route {$name} uses the reserved path /_hyper (HY-40)",
                    'invalid_application',
                );
            }
            $routeRegions = [];
            foreach (self::entries($route, 'regions') as $region) {
                $regionName = is_string($region['name'] ?? null) ? $region['name'] : '';
                $regionTemplate = $region['template'] ?? null;
                if (!self::regionName($regionName) || isset($regionNames[$regionName]) || !is_string($regionTemplate)) {
                    throw new HyperValueError(
                        "manifest route {$name} has an invalid or duplicated region {$regionName}",
                        'invalid_application',
                    );
                }
                $regionNames[$regionName] = true;
                $kept = self::keptKinds($region, $regionName);
                $routeRegions[] = new Region($regionName, false, $regionTemplate, $kept);
            }
            $routeObject = $routeObjects[$index] ?? null;
            $routes[$name] = [
                'name' => $name,
                'path' => $path,
                'title' => $title,
                'template' => $template,
                'post' => ($route['post'] ?? false) === true,
                'regions' => $routeRegions,
                'representations' => RepresentationEntries::declare(
                    $name,
                    match (true) {
                        !array_key_exists('representations', $route) => [],
                        default => JsonCodec::mapEntries($routeObject)['representations'] ?? null,
                    },
                ),
            ];
        }

        return new self(
            array_values($regions),
            $page,
            $routes,
            new Router(array_values($routes)),
        );
    }

    /**
     * Returns the objects of the list under a key, which may be absent (HY-2).
     *
     * @param array<mixed> $object
     * @return list<array<mixed>>
     */
    private static function entries(array $object, string $key): array
    {
        $list = $object[$key] ?? [];
        if (!is_array($list) || !array_is_list($list)) {
            throw new HyperValueError("manifest {$key} is not a list", 'invalid_application');
        }
        $entries = [];
        foreach ($list as $entry) {
            if (!is_array($entry)) {
                throw new HyperValueError(
                    "manifest {$key} contains a value that is not an object",
                    'invalid_application',
                );
            }
            $entries[] = $entry;
        }

        return $entries;
    }

    /**
     * Returns the kept paths of a route region by path; the region checks the paths and kinds (HY-37).
     *
     * @param array<mixed> $region
     * @return array<string, string>
     */
    private static function keptKinds(array $region, string $name): array
    {
        $declared = $region['keep'] ?? [];
        if (!is_array($declared)) {
            throw new HyperValueError(
                "region {$name} has kept paths that are not an object",
                'invalid_application',
            );
        }
        $keep = [];
        foreach ($declared as $path => $kind) {
            if (!is_string($path) || !is_string($kind)) {
                throw new HyperValueError(
                    "region {$name} has an invalid kept path {$path}",
                    'invalid_application',
                );
            }
            $keep[$path] = $kind;
        }

        return $keep;
    }

    /** Returns the manifest region or the route region with a name, or null. */
    public function region(string $name): ?Region
    {
        foreach ($this->regions as $region) {
            if ($region->name === $name) {
                return $region;
            }
        }
        foreach ($this->routes as $route) {
            foreach ($route['regions'] as $region) {
                if ($region->name === $name) {
                    return $region;
                }
            }
        }

        return null;
    }

    /** Returns true for an allowed region name (HY-2.3). */
    private static function regionName(string $name): bool
    {
        return preg_match('/^[A-Za-z][A-Za-z0-9_-]*$/D', $name) === 1 && !in_array(
            $name,
            ['layout', 'title', 'data', 'build'],
            true,
        );
    }
}
