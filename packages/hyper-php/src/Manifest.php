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
        foreach ($data['regions'] ?? [] as $region) {
            $name = (string) ($region['name'] ?? '');
            if (!self::regionName($name) || isset($regions[$name])) {
                throw new \InvalidArgumentException("manifest region name {$name} is not allowed");
            }
            $isPage = ($region['page'] ?? false) === true;
            $template = $region['template'] ?? null;
            if ($isPage === is_string($template)) {
                throw new \InvalidArgumentException("manifest region {$name} must have a template unless it is the page region");
            }
            $regions[$name] = new Region($name, $isPage, $template, array_values($region['uses'] ?? []), $region['keep'] ?? []);
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
        foreach ($data['routes'] ?? [] as $route) {
            $name = (string) ($route['name'] ?? '');
            if ($name === '' || isset($routes[$name]) || !is_string($route['title'] ?? null) || !is_string($route['template'] ?? null)) {
                throw new \InvalidArgumentException("manifest route {$name} is duplicated or incomplete");
            }
            if (str_starts_with((string) ($route['path'] ?? ''), '/_hyper')) {
                throw new \InvalidArgumentException("manifest route {$name} uses the reserved path /_hyper (HY-40)");
            }
            $routeRegions = [];
            foreach ($route['regions'] ?? [] as $region) {
                $regionName = (string) ($region['name'] ?? '');
                if (!self::regionName($regionName) || isset($regionNames[$regionName]) || !is_string($region['template'] ?? null)) {
                    throw new \InvalidArgumentException("manifest route {$name} has an invalid or duplicated region {$regionName}");
                }
                $regionNames[$regionName] = true;
                $routeRegions[] = new Region($regionName, false, $region['template'], [], $region['keep'] ?? []);
            }
            $routes[$name] = [
                'name' => $name,
                'path' => (string) ($route['path'] ?? ''),
                'title' => $route['title'],
                'template' => $route['template'],
                'post' => ($route['post'] ?? false) === true,
                'regions' => $routeRegions,
            ];
        }

        return new self($data['layout'], $data['title'], array_values($regions), $page, $routes, new Router(array_values($routes)));
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
