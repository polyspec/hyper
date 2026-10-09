<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** The application manifest: layout, title, regions and routes (HY-1, HY-2). */
final class Manifest
{
    /**
     * @param list<Region> $regions
     * @param array<string, array{name: string, path: string, title: string, template: string, post: bool, regions: list<Region>}> $routes
     */
    private function __construct(
        public readonly string $layout,
        public readonly string $title,
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
            throw new \InvalidArgumentException("manifest {$file} does not exist");
        }
        $data = json_decode((string) file_get_contents($file), true, flags: JSON_THROW_ON_ERROR);
        if (!is_array($data) || !is_string($data['layout'] ?? null) || !is_string($data['title'] ?? null)) {
            throw new \InvalidArgumentException("manifest {$file} has no layout or title template");
        }

        $regions = [];
        $page = null;
        foreach (self::entries($data, 'regions') as $region) {
            $name = is_string($region['name'] ?? null) ? $region['name'] : '';
            if (!self::regionName($name) || isset($regions[$name])) {
                throw new \InvalidArgumentException("manifest region name {$name} is not allowed");
            }
            $isPage = ($region['page'] ?? false) === true;
            $template = $region['template'] ?? null;
            if ($isPage === is_string($template)) {
                throw new \InvalidArgumentException("manifest region {$name} must have a template unless it is the page region");
            }
            $declaredUses = $region['uses'] ?? [];
            if (!is_array($declaredUses)) {
                throw new \InvalidArgumentException("manifest region {$name} uses an invalid topic");
            }
            $uses = [];
            foreach ($declaredUses as $topic) {
                if (!is_string($topic) || preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/D', $topic) !== 1) {
                    throw new \InvalidArgumentException("manifest region {$name} uses an invalid topic");
                }
                $uses[] = $topic;
            }
            // HY-37: only route regions change in the browser, so only they keep values.
            if (array_key_exists('keep', $region)) {
                throw new \InvalidArgumentException("manifest region {$name} cannot keep values; only route regions keep values");
            }
            $regions[$name] = new Region($name, $isPage, is_string($template) ? $template : null, $uses);
            if ($isPage) {
                if ($page !== null) {
                    throw new \InvalidArgumentException('manifest declares more than one page region');
                }
                $page = $regions[$name];
            }
        }
        if ($page === null) {
            throw new \InvalidArgumentException('manifest declares no page region');
        }

        $routes = [];
        $regionNames = array_fill_keys(array_keys($regions), true);
        foreach (self::entries($data, 'routes') as $route) {
            $name = is_string($route['name'] ?? null) ? $route['name'] : '';
            $title = $route['title'] ?? null;
            $template = $route['template'] ?? null;
            $path = $route['path'] ?? null;
            if ($name === '' || isset($routes[$name]) || !is_string($title) || !is_string($template) || !is_string($path)) {
                throw new \InvalidArgumentException("manifest route {$name} is duplicated or incomplete");
            }
            if (str_starts_with($path, '/_hyper')) {
                throw new \InvalidArgumentException("manifest route {$name} uses the reserved path /_hyper (HY-40)");
            }
            $routeRegions = [];
            foreach (self::entries($route, 'regions') as $region) {
                $regionName = is_string($region['name'] ?? null) ? $region['name'] : '';
                $regionTemplate = $region['template'] ?? null;
                if (!self::regionName($regionName) || isset($regionNames[$regionName]) || !is_string($regionTemplate)) {
                    throw new \InvalidArgumentException("manifest route {$name} has an invalid or duplicated region {$regionName}");
                }
                $regionNames[$regionName] = true;
                $routeRegions[] = new Region($regionName, false, $regionTemplate, [], self::keep($region, $regionName));
            }
            $routes[$name] = [
                'name' => $name,
                'path' => $path,
                'title' => $title,
                'template' => $template,
                'post' => ($route['post'] ?? false) === true,
                'regions' => $routeRegions,
            ];
        }

        return new self($data['layout'], $data['title'], array_values($regions), $page, $routes, new Router(array_values($routes)));
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
            throw new \InvalidArgumentException("manifest {$key} is not a list");
        }
        $entries = [];
        foreach ($list as $entry) {
            if (!is_array($entry)) {
                throw new \InvalidArgumentException("manifest {$key} contains a value that is not an object");
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
    private static function keep(array $region, string $name): array
    {
        $declared = $region['keep'] ?? [];
        if (!is_array($declared)) {
            throw new \InvalidArgumentException("region {$name} has kept paths that are not an object");
        }
        $keep = [];
        foreach ($declared as $path => $kind) {
            if (!is_string($path) || !is_string($kind)) {
                throw new \InvalidArgumentException("region {$name} has an invalid kept path {$path}");
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

    /** Returns true for an allowed region name (HY-2). */
    private static function regionName(string $name): bool
    {
        return preg_match('/^[A-Za-z][A-Za-z0-9_-]*$/D', $name) === 1 && !in_array($name, ['layout', 'title', 'data'], true);
    }
}
