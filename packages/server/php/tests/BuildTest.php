<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\App;
use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\Request;

/**
 * HY-128: every JSON response holds the build id of the application after `params`; contracts/build.json holds the
 * cases of the build id that `build.json` gives (HY-125). The fixture program holds the build id 64 characters `1`.
 */
final class BuildTest extends TestCase
{
    private const PROGRAM = __DIR__ . '/build/server';
    private const MANIFEST = __DIR__ . '/fixtures/app.json';
    private const BUILD = '1111111111111111111111111111111111111111111111111111111111111111';

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
}
