<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\Attributes\RunInSeparateProcess;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\App;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Response;
use Polyspec\Hyper\Result;

/** HY-43, HY-52: the PHP settings that `App::run` applies before it answers the request. */
final class RunTest extends TestCase
{
    #[RunInSeparateProcess]
    public function testRunTurnsOffErrorOutputAndTheDefaultContentType(): void
    {
        $app = App::open(__DIR__ . '/fixtures/app.json', __DIR__ . '/build/server', ['routes' => ['add' => ['post' => fn (): Result => Result::redirect('/')]]], 'Z');
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/missing';

        ob_start();
        $app->run();
        $body = ob_get_clean();

        self::assertSame('Not Found', $body);
        self::assertSame('0', ini_get('display_errors'));
        // A response without a body, such as a redirect, would otherwise receive PHP's text/html type.
        self::assertSame('', ini_get('default_mimetype'));
    }

    /** HY-59: PHP must give the application every body up to the limit, which post_max_size and the post data reading decide. */
    #[RunInSeparateProcess]
    public function testRunRefusesALimitThatPhpCannotDeliver(): void
    {
        $handlers = ['routes' => ['add' => ['post' => fn (): Result => Result::redirect('/')]]];
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/missing';
        self::assertSame('8M', ini_get('post_max_size'));
        self::assertSame('1', ini_get('enable_post_data_reading'));
        foreach ([['bodyLimit' => 8 * 1024 * 1024 + 1], ['formTypes' => ['multipart/form-data']]] as $options) {
            $app = App::open(__DIR__ . '/fixtures/app.json', __DIR__ . '/build/server', $handlers, 'Z', ...$options);
            try {
                $app->run();
                self::fail('run accepted ' . json_encode($options));
            } catch (\LogicException) {
                self::addToAssertionCount(1);
            }
        }
        ob_start();
        App::open(__DIR__ . '/fixtures/app.json', __DIR__ . '/build/server', $handlers, 'Z', bodyLimit: 8 * 1024 * 1024)->run();
        self::assertSame('Not Found', ob_get_clean());
    }

    /** HY-60: the elapsed time of a PHP request counts from REQUEST_TIME_FLOAT, the start of the request. */
    #[RunInSeparateProcess]
    public function testRunReportsTheElapsedTimeSinceTheRequestStarted(): void
    {
        $reports = [];
        $app = App::open(__DIR__ . '/fixtures/app.json', __DIR__ . '/build/server', ['routes' => ['add' => ['post' => fn (): Result => Result::redirect('/')]]], 'Z', onResponse: function (Request $request, Response $response, float $elapsed) use (&$reports): void {
            $reports[] = [$request->path(), $response->status, $elapsed];
        });
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/missing';
        $_SERVER['REQUEST_TIME_FLOAT'] = microtime(true) - 1.5;

        ob_start();
        $app->run();
        ob_end_clean();

        self::assertCount(1, $reports);
        self::assertSame(['/missing', 404], array_slice($reports[0], 0, 2));
        self::assertGreaterThanOrEqual(1500.0, $reports[0][2]);
    }
}
