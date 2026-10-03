<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Router;
use Polyspec\Hyper\Tests\Support\Json;

/** HY-9: these are the same cases that the JavaScript router passes. */
final class RouterTest extends TestCase
{
    /** @return array<array-key, mixed> */
    private static function fixture(): array
    {
        return Json::file(__DIR__ . '/../../../conformance/routes.json');
    }

    /** @return list<array{name: string, path: string}> */
    private static function routes(mixed $routes): array
    {
        return array_map(fn (array $route): array => ['name' => Json::string($route['name'] ?? null), 'path' => Json::string($route['path'] ?? null)], Json::arrays($routes));
    }

    /**
     * @param array<array-key, mixed> $case
     * @return array{string, array{name: string, params: array<string, string>}|null}
     */
    private static function routeCase(array $case): array
    {
        $result = $case['result'] ?? null;
        if ($result !== null) {
            $result = Json::array($result);
            $result = ['name' => Json::string($result['name'] ?? null), 'params' => Json::stringMap($result['params'] ?? null)];
        }

        return [Json::string($case['path'] ?? null), $result];
    }

    /** @return iterable<string, array{string, array{name: string, params: array<string, string>}|null}> */
    public static function cases(): iterable
    {
        foreach (Json::arrays(self::fixture()['cases'] ?? null) as $case) {
            $routeCase = self::routeCase($case);
            yield json_encode($routeCase[0], JSON_THROW_ON_ERROR) => $routeCase;
        }
    }

    /** @return iterable<string, array{string, array{name: string, params: array<string, string>}|null}> */
    public static function baseCases(): iterable
    {
        foreach (Json::arrays(self::fixture()['baseCases'] ?? null) as $case) {
            $routeCase = self::routeCase($case);
            yield json_encode($routeCase[0], JSON_THROW_ON_ERROR) => $routeCase;
        }
    }

    /** @return iterable<string, array{string}> */
    public static function invalidPaths(): iterable
    {
        foreach (Json::strings(self::fixture()['invalidPaths'] ?? null) as $path) {
            yield json_encode($path, JSON_THROW_ON_ERROR) => [$path];
        }
    }

    /** @param array{name: string, params: array<string, string>}|null $expected */
    #[DataProvider('cases')]
    public function testRoutesThePath(string $path, ?array $expected): void
    {
        self::assertSame(self::normalize($expected), self::normalize((new Router(self::routes(self::fixture()['routes'] ?? null)))->match($path)));
    }

    /** @param array{name: string, params: array<string, string>}|null $expected */
    #[DataProvider('baseCases')]
    public function testRoutesThePathUnderTheBasePath(string $path, ?array $expected): void
    {
        $fixture = self::fixture();
        $stripped = Router::stripBasePath($path, Json::string($fixture['basePath'] ?? null));
        $result = $stripped === null ? null : (new Router(self::routes($fixture['routes'] ?? null)))->match($stripped);
        self::assertSame(self::normalize($expected), self::normalize($result));
    }

    #[DataProvider('invalidPaths')]
    public function testRejectsTheRoutePath(string $path): void
    {
        $this->expectException(\InvalidArgumentException::class);
        new Router([['name' => 'invalid', 'path' => $path]]);
    }

    /**
     * Compares parameter maps by key and value; JSON decoding gives an empty list for an empty map.
     *
     * @param array{name: string, params: array<string, string>}|null $result
     */
    private static function normalize(?array $result): ?string
    {
        return $result === null ? null : json_encode(['name' => $result['name'], 'params' => (object) $result['params']], JSON_THROW_ON_ERROR);
    }

    /** @return array<array-key, mixed> */
    private static function rest(): array
    {
        return Json::file(__DIR__ . '/../../../conformance/rest.json');
    }

    /** @return iterable<string, array{string, array{name: string, params: array<string, string>}|null}> */
    public static function restCases(): iterable
    {
        foreach (Json::arrays(self::rest()['cases'] ?? null) as $case) {
            $routeCase = self::routeCase($case);
            yield json_encode($routeCase[0], JSON_THROW_ON_ERROR) => $routeCase;
        }
    }

    /** @return iterable<string, array{string}> */
    public static function invalidRestPaths(): iterable
    {
        foreach (Json::strings(self::rest()['invalidPaths'] ?? null) as $path) {
            yield json_encode($path, JSON_THROW_ON_ERROR) => [$path];
        }
    }

    /**
     * HY-49: these are the same rest parameter cases that the JavaScript router passes.
     *
     * @param array{name: string, params: array<string, string>}|null $expected
     */
    #[DataProvider('restCases')]
    public function testRoutesTheRestOfThePath(string $path, ?array $expected): void
    {
        self::assertSame(self::normalize($expected), self::normalize((new Router(self::routes(self::rest()['routes'] ?? null)))->match($path)));
    }

    #[DataProvider('invalidRestPaths')]
    public function testRejectsTheRestPath(string $path): void
    {
        $this->expectException(\InvalidArgumentException::class);
        new Router([['name' => 'invalid', 'path' => $path]]);
    }
}
