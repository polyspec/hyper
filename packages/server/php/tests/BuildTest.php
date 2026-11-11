<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\App;
use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\Request;

/**
 * HY-125, HY-128: the build id of the application is read when it opens, and every JSON response holds it after
 * `params`. The fixture program holds the build id of the fixture file, 64 characters `1`.
 */
final class BuildTest extends TestCase
{
    private const PROGRAM = __DIR__ . '/build/server';
    private const MANIFEST = __DIR__ . '/fixtures/app.json';
    private const BUILD = '1111111111111111111111111111111111111111111111111111111111111111';

    /** @return iterable<string, array{string}> */
    public static function invalidBuildFiles(): iterable
    {
        yield 'an empty object' => ['{}'];
        yield 'a short build id' => ['{"build":"ABC"}'];
        yield 'an uppercase build id' => ['{"build":"A' . str_repeat('1', 63) . '"}'];
        yield 'an extra key' => ['{"build":"' . str_repeat('1', 64) . '","extra":1}'];
        yield 'text that is not JSON' => ['not json'];
    }

    #[DataProvider('invalidBuildFiles')]
    public function testOpenNamesTheBuildFileThatIsInvalid(string $text): void
    {
        $program = $this->copyProgram();
        try {
            file_put_contents("{$program}/build.json", $text);

            $this->expectException(\InvalidArgumentException::class);
            $this->expectExceptionMessage("{$program}/build.json");
            $this->open($program);
        } finally {
            exec('rm -rf ' . escapeshellarg($program));
        }
    }

    public function testOpenNamesTheBuildFileThatIsMissing(): void
    {
        $program = $this->copyProgram();
        try {
            unlink("{$program}/build.json");

            $this->expectException(\InvalidArgumentException::class);
            $this->expectExceptionMessage("{$program}/build.json");
            $this->open($program);
        } finally {
            exec('rm -rf ' . escapeshellarg($program));
        }
    }

    public function testOpenReadsTheBuildIdOfTheFixture(): void
    {
        self::assertSame(
            '{"build":"' . self::BUILD . '"}',
            file_get_contents(self::PROGRAM . '/build.json'),
        );
        $app = $this->open(self::PROGRAM);
        $response = $app->handle(
            new Request('GET', '/items/a%20b', ['Accept' => 'application/vnd.hyper+json', 'HX-Request' => 'true']),
            new ArraySession(),
        );

        self::assertSame(200, $response->status);
        // HY-128: the member build follows params, and the bytes of the JSON text show its place.
        self::assertStringStartsWith(
            '{"env":{"timezone":"Z"},"route":"item","params":{"id":"a b"},"build":"' . self::BUILD . '","shared":',
            $response->body,
        );
    }

    /** Opens the application; the route add declares a POST action, which the open checks but no test runs. */
    private function open(string $program): App
    {
        return App::open(self::MANIFEST, $program, [
            'routes' => ['add' => ['post' => static fn (): never => throw new \LogicException('not run')]],
        ], 'Z');
    }

    /** Copies the fixture program into a directory of the test, which the test removes. */
    private function copyProgram(): string
    {
        $program = sys_get_temp_dir() . '/hyper-build-' . bin2hex(random_bytes(6));
        exec('cp -R ' . escapeshellarg(self::PROGRAM) . ' ' . escapeshellarg($program), $output, $status);
        self::assertSame(0, $status, implode("\n", $output));

        return $program;
    }
}
