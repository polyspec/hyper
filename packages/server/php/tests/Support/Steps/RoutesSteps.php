<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\Router;
use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\Plain;

/** HY-4, HY-5: the cases of contracts/routes.json. */
final class RoutesSteps
{
    public static function cases(CaseReader $case): void
    {
        $case->compare('result', self::route($case->input('routes'), (string) $case->input('path')));
    }

    public static function baseCases(CaseReader $case): void
    {
        $stripped = Router::stripBasePath((string) $case->input('path'), (string) $case->input('basePath'));
        $case->compare('result', $stripped === null ? null : self::route($case->input('routes'), $stripped));
    }

    public static function invalidPaths(CaseReader $case): void
    {
        $case->outcome('router', self::refuses((string) $case->input('path')));
    }

    /** @return ?array{name: string, params: array<array-key, mixed>|\stdClass} the route with its parameters */
    public static function route(mixed $routes, string $path): ?array
    {
        $result = (new Router(self::routes($routes)))->match($path);

        return $result === null ? null : ['name' => $result['name'], 'params' => Plain::map($result['params'])];
    }

    /** Whether the router refuses a route path. */
    public static function refuses(string $path): bool
    {
        try {
            new Router([['name' => 'invalid', 'path' => $path]]);
        } catch (\InvalidArgumentException) {
            return true;
        }

        return false;
    }

    /** @return list<array{name: string, path: string}> */
    public static function routes(mixed $routes): array
    {
        return array_map(
            static fn (array $route): array => ['name' => (string) $route['name'], 'path' => (string) $route['path']],
            is_array($routes) ? $routes : [],
        );
    }
}
