<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** Route matching (HY-4 to HY-8). The JavaScript router implements the same rules; both pass conformance/routes.json. */
final class Router
{
    /** @var list<array{name: string, segments: list<array{0: 'literal'|'param', 1: string}>}> */
    private readonly array $routes;

    /**
     * Compiles route paths; an invalid path fails here (HY-4).
     *
     * @param list<array{name: string, path: string}> $routes
     */
    public function __construct(array $routes)
    {
        $compiled = [];
        foreach ($routes as $route) {
            $compiled[] = ['name' => $route['name'], 'segments' => self::compile($route['path'])];
        }
        $this->routes = $compiled;
    }

    /**
     * Returns the first route that matches a request path, or null (HY-5 to HY-7).
     *
     * @return array{name: string, params: array<string, string>}|null
     */
    public function match(string $path): ?array
    {
        if (!str_starts_with($path, '/')) {
            return null;
        }
        $parts = $path === '/' ? [] : explode('/', substr($path, 1));
        foreach ($this->routes as $route) {
            $params = self::matchSegments($route['segments'], $parts);
            if ($params !== null) {
                return ['name' => $route['name'], 'params' => $params];
            }
        }

        return null;
    }

    /** Removes a base path from a request path; returns null when the path is outside the base path (HY-8). */
    public static function stripBasePath(string $path, string $basePath): ?string
    {
        if ($basePath === '') {
            return $path;
        }
        if ($path === $basePath) {
            return '/';
        }

        return str_starts_with($path, $basePath . '/') ? substr($path, strlen($basePath)) : null;
    }

    /** @return list<array{0: 'literal'|'param', 1: string}> */
    private static function compile(string $path): array
    {
        if (!str_starts_with($path, '/')) {
            throw new \InvalidArgumentException("route path {$path} does not start with /");
        }
        if ($path === '/') {
            return [];
        }
        $segments = [];
        $names = [];
        foreach (explode('/', substr($path, 1)) as $part) {
            if (preg_match('/^[A-Za-z0-9._~-]+$/D', $part) === 1) {
                $segments[] = ['literal', $part];
            } elseif (preg_match('/^\{([A-Za-z_][A-Za-z0-9_]*)\}$/D', $part, $found) === 1 && !isset($names[$found[1]])) {
                $names[$found[1]] = true;
                $segments[] = ['param', $found[1]];
            } else {
                throw new \InvalidArgumentException("route path {$path} has an invalid segment {$part}");
            }
        }

        return $segments;
    }

    /**
     * @param list<array{0: 'literal'|'param', 1: string}> $segments
     * @param list<string> $parts
     * @return array<string, string>|null
     */
    private static function matchSegments(array $segments, array $parts): ?array
    {
        if (count($segments) !== count($parts)) {
            return null;
        }
        $params = [];
        foreach ($segments as $index => [$kind, $value]) {
            $part = $parts[$index];
            if ($kind === 'literal') {
                if ($value !== $part) {
                    return null;
                }
                continue;
            }
            $decoded = $part === '' ? null : self::decodeSegment($part);
            if ($decoded === null) {
                return null;
            }
            $params[$value] = $decoded;
        }

        return $params;
    }

    /** Decodes %XX sequences to bytes and requires valid UTF-8; returns null for a malformed segment (HY-6). */
    private static function decodeSegment(string $part): ?string
    {
        if (preg_match('/%(?![0-9A-Fa-f]{2})/', $part) === 1) {
            return null;
        }
        $decoded = rawurldecode($part);

        return preg_match('//u', $decoded) === 1 ? $decoded : null;
    }
}
