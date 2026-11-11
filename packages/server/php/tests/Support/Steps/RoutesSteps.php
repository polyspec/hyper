<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\Router;
use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\Plain;

/** HY-4, HY-5, HY-8: the cases of contracts/routes.json. */
final class RoutesSteps
{
    public static function cases(CaseReader $case): void
    {
        $case->compare('result', self::route($case->input('routes'), (string) $case->input('path')));
    }

    public static function baseCases(CaseReader $case): void
    {
        $routes = $case->input('routes');
        $stripped = Router::stripBasePath((string) $case->input('path'), (string) $case->input('basePath'));
        $case->compare('result', $stripped === null ? null : self::route($routes, $stripped));
    }

    public static function invalidPaths(CaseReader $case): void
    {
        $case->outcome('router', self::refusal((string) $case->input('path')));
    }

    /** @return ?array{name: string, params: array<array-key, mixed>|\stdClass} the route with its parameters */
    public static function route(mixed $routes, string $path): ?array
    {
        $result = (new Router(self::routes($routes)))->match($path);

        return $result === null ? null : ['name' => $result['name'], 'params' => Plain::map($result['params'])];
    }

    /** The error that the router raises for a route path, or null (HY-4): the step gives it to the reader. */
    public static function refusal(string $path): ?\Throwable
    {
        try {
            new Router([['name' => 'invalid', 'path' => $path]]);
        } catch (\Throwable $error) {
            return $error;
        }

        return null;
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
