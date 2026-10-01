<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\Attributes\RunInSeparateProcess;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\App;
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
}
