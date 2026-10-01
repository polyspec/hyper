<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Router;

/** HY-9: these are the same cases that the JavaScript router passes. */
final class RouterTest extends TestCase
{
    /** @return array<string, mixed> */
    private static function fixture(): array
    {
        return json_decode((string) file_get_contents(__DIR__ . '/../../../conformance/routes.json'), true, flags: JSON_THROW_ON_ERROR);
    }

    /** @return iterable<string, array{string, array{name: string, params: array<string, string>}|null}> */
    public static function cases(): iterable
    {
        foreach (self::fixture()['cases'] as $case) {
            yield json_encode($case['path']) => [$case['path'], $case['result']];
        }
    }

    /** @return iterable<string, array{string, array{name: string, params: array<string, string>}|null}> */
    public static function baseCases(): iterable
    {
        foreach (self::fixture()['baseCases'] as $case) {
            yield json_encode($case['path']) => [$case['path'], $case['result']];
        }
    }

    /** @return iterable<string, array{string}> */
    public static function invalidPaths(): iterable
    {
        foreach (self::fixture()['invalidPaths'] as $path) {
            yield json_encode($path) => [$path];
        }
    }

    /** @param array{name: string, params: array<string, string>}|null $expected */
    #[DataProvider('cases')]
    public function testRoutesThePath(string $path, ?array $expected): void
    {
        self::assertSame(self::normalize($expected), self::normalize((new Router(self::fixture()['routes']))->match($path)));
    }

    /** @param array{name: string, params: array<string, string>}|null $expected */
    #[DataProvider('baseCases')]
    public function testRoutesThePathUnderTheBasePath(string $path, ?array $expected): void
    {
        $fixture = self::fixture();
        $stripped = Router::stripBasePath($path, $fixture['basePath']);
        $result = $stripped === null ? null : (new Router($fixture['routes']))->match($stripped);
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
}
