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
}
