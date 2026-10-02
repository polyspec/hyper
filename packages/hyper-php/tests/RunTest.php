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

    /** HY-67: PHP ends the script at the first failed write of the response and calls the disconnect hook. */
    public function testRunCallsTheDisconnectHookWhenTheClientClosedTheConnection(): void
    {
        $log = tempnam(sys_get_temp_dir(), 'hyper-disconnect-');
        $port = self::freePort();
        // ignore_user_abort is on here, so App::run must turn it off.
        $server = proc_open([PHP_BINARY, '-d', 'ignore_user_abort=1', '-S', "127.0.0.1:{$port}", __DIR__ . '/Support/disconnect.php'], [0 => ['file', '/dev/null', 'r'], 1 => ['file', '/dev/null', 'w'], 2 => ['pipe', 'w']], $pipes, null, [...getenv(), 'HYPER_DISCONNECT_LOG' => $log]);
        try {
            self::waitFor($pipes[2], 'started');
            $client = stream_socket_client("tcp://127.0.0.1:{$port}");
            fwrite($client, "GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
            usleep(50_000);
            fclose($client);
            self::waitFor($pipes[2], 'Closing');
        } finally {
            proc_terminate($server);
            proc_close($server);
        }
        $lines = (string) file_get_contents($log);
        unlink($log);
        self::assertSame("response 200\ndisconnect GET / 1 {\"stage\":\"shared\"}\n", $lines);
    }

    private static function freePort(): int
    {
        $socket = stream_socket_server('tcp://127.0.0.1:0');
        $name = (string) stream_socket_get_name($socket, false);
        fclose($socket);

        return (int) substr($name, strrpos($name, ':') + 1);
    }

    /** Reads the standard error of the PHP built-in server until a line contains the text, for at most 5 seconds. */
    private static function waitFor($stderr, string $text): void
    {
        $deadline = microtime(true) + 5.0;
        $seen = '';
        while (microtime(true) < $deadline) {
            $read = [$stderr];
            $none = null;
            if (stream_select($read, $none, $none, 0, 200_000) === 1) {
                $line = fgets($stderr);
                if ($line === false) {
                    break;
                }
                $seen .= $line;
                if (str_contains($line, $text)) {
                    return;
                }
            }
        }
        self::fail("the server wrote no line with {$text}: {$seen}");
    }
}
