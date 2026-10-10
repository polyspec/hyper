<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\Attributes\RunInSeparateProcess;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\App;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Response;
use Polyspec\Hyper\Result;
use Polyspec\Hyper\Tests\Support\Json;

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

    /** HY-74: a warning, notice or deprecation of a request fails it with the plain 500 of HY-43; `@` stays silent. */
    public function testWarningsNoticesAndDeprecationsFailTheRequest(): void
    {
        exec(escapeshellarg(PHP_BINARY) . ' -d error_log=/dev/null -d display_errors=0 ' . escapeshellarg(__DIR__ . '/Support/warnings.php'), $lines, $status);

        self::assertSame(0, $status, implode("\n", $lines));
        self::assertSame([
            ['undefined-key', 500, 'Internal Server Error'],
            ['user-notice', 500, 'Internal Server Error'],
            ['deprecation', 500, 'Internal Server Error'],
            ['silenced', 200, '{"env":{"timezone":"Z"},"route":"item","params":{"id":"silenced"},"shared":{"title":"Item"},"regions":{"side":{},"content":{"id":"silenced"}},"kept":{}}'],
            ['handler', true],
        ], array_map(Json::decode(...), $lines));
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
        $apps = [
            'bodyLimit' => App::open(__DIR__ . '/fixtures/app.json', __DIR__ . '/build/server', $handlers, 'Z', bodyLimit: 8 * 1024 * 1024 + 1),
            'formTypes' => App::open(__DIR__ . '/fixtures/app.json', __DIR__ . '/build/server', $handlers, 'Z', formTypes: ['multipart/form-data']),
        ];
        foreach ($apps as $option => $app) {
            try {
                $app->run();
                self::fail("run accepted the option {$option}");
            } catch (\LogicException) {
                self::addToAssertionCount(1);
            }
        }
        ob_start();
        App::open(__DIR__ . '/fixtures/app.json', __DIR__ . '/build/server', $handlers, 'Z', bodyLimit: 8 * 1024 * 1024)->run();
        self::assertSame('Not Found', ob_get_clean());
    }

    /** HY-60: the elapsed time of a PHP request counts on the monotonic clock from the start that the caller gives. */
    #[RunInSeparateProcess]
    public function testRunReportsTheElapsedTimeSinceTheRequestStarted(): void
    {
        $reports = [];
        $app = App::open(__DIR__ . '/fixtures/app.json', __DIR__ . '/build/server', ['routes' => ['add' => ['post' => fn (): Result => Result::redirect('/')]]], 'Z', onResponse: function (Request $request, Response $response, float $elapsed) use (&$reports): void {
            $reports[] = [$request->path(), $response->status, $elapsed];
        });
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/missing';

        ob_start();
        $app->run(hrtime(true) - 1_500_000_000);
        ob_end_clean();

        self::assertCount(1, $reports);
        self::assertSame(['/missing', 404], array_slice($reports[0], 0, 2));
        self::assertGreaterThanOrEqual(1500.0, $reports[0][2]);
        self::assertLessThan(60000.0, $reports[0][2]);
    }

    /**
     * HY-60: the elapsed time never reads the wall clock, so a system time that moves backwards during a request,
     * here a REQUEST_TIME_FLOAT ten seconds after now, gives no negative time.
     */
    #[RunInSeparateProcess]
    public function testRunReportsNoNegativeElapsedTimeWhenTheWallClockMovesBackwards(): void
    {
        $reports = [];
        $app = App::open(__DIR__ . '/fixtures/app.json', __DIR__ . '/build/server', ['routes' => ['add' => ['post' => fn (): Result => Result::redirect('/')]]], 'Z', onResponse: function (Request $request, Response $response, float $elapsed) use (&$reports): void {
            $reports[] = $elapsed;
        });
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/missing';
        $_SERVER['REQUEST_TIME_FLOAT'] = microtime(true) + 10.0;

        ob_start();
        $app->run();
        ob_end_clean();

        self::assertCount(1, $reports);
        self::assertGreaterThanOrEqual(0.0, $reports[0]);
        self::assertLessThan(10000.0, $reports[0]);
    }

    /** HY-67: PHP ends the script at the first failed write of the response and calls the disconnect hook. */
    public function testRunCallsTheDisconnectHookWhenTheClientClosedTheConnection(): void
    {
        // The log and the server are released when the case ends, also when it fails (HY-87).
        $log = (string) tempnam(sys_get_temp_dir(), 'hyper-disconnect-');
        $server = false;
        try {
            // The server listens on a port that the system assigns and reports it, so no other process can take the
            // port between its choice and its use (HY-89). ignore_user_abort is on here, so App::run must turn it off.
            $server = proc_open([PHP_BINARY, '-d', 'ignore_user_abort=1', '-S', '127.0.0.1:0', __DIR__ . '/Support/disconnect.php'], [0 => ['file', '/dev/null', 'r'], 1 => ['file', '/dev/null', 'w'], 2 => ['pipe', 'w']], $pipes, null, [...getenv(), 'HYPER_DISCONNECT_LOG' => $log]);
            if ($server === false) {
                self::fail('the PHP built-in server did not start');
            }
            $started = self::waitFor($pipes[2], 'started');
            if (preg_match('/\(http:\/\/127\.0\.0\.1:(\d+)\) started/', $started, $address) !== 1) {
                self::fail("the server reported no address: {$started}");
            }
            $port = (int) $address[1];
            $client = stream_socket_client("tcp://127.0.0.1:{$port}");
            if ($client === false) {
                self::fail("no connection to port {$port}");
            }
            fwrite($client, "GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
            usleep(50_000);
            fclose($client);
            self::waitFor($pipes[2], 'Closing');
            $lines = (string) file_get_contents($log);
        } finally {
            if ($server !== false) {
                proc_terminate($server);
                proc_close($server);
            }
            unlink($log);
        }
        self::assertSame("response 200\ndisconnect GET / 1 {\"stage\":\"shared\"}\n", $lines);
    }

    /** HY-60: a fatal error before the response hook runs writes the plain 500 and reports it to the hook once. */
    public function testAFatalErrorBeforeTheResponseHookWritesThePlain500AndReportsIt(): void
    {
        [$status, $headers, $body, $lines] = self::escape('fatal');

        self::assertSame(500, $status);
        self::assertSame('Internal Server Error', $body);
        self::assertContains('Cache-Control: no-store', $headers);
        self::assertContains("Content-Security-Policy: frame-ancestors 'self'", $headers);
        self::assertSame("response 500\n", $lines);
    }

    /** HY-60: a fatal error after the response hook ran writes the plain 500 and calls the hook no second time. */
    public function testAFatalErrorAfterTheResponseHookWritesThePlain500WithoutASecondReport(): void
    {
        [$status, $headers, $body, $lines] = self::escape('hook-fatal');

        self::assertSame(500, $status);
        self::assertSame('Internal Server Error', $body);
        self::assertContains('Cache-Control: no-store', $headers);
        self::assertSame("response 200\n", $lines);
    }

    /** HY-60: an uncaught exception after the response hook ran writes the plain 500 through the exception handler. */
    public function testAnUncaughtExceptionAfterTheResponseHookWritesThePlain500WithoutASecondReport(): void
    {
        [$status, $headers, $body, $lines] = self::escape('hook-throws');

        self::assertSame(500, $status);
        self::assertSame('Internal Server Error', $body);
        self::assertContains('Cache-Control: no-store', $headers);
        self::assertSame("response 200\n", $lines);
    }

    /**
     * Serves the escape front controller in the given mode with the PHP built-in server and returns the status, the
     * headers, the body of the response and the lines that the response hook appended to the log.
     *
     * @return array{int, list<string>, string, string}
     */
    private static function escape(string $mode): array
    {
        $log = (string) tempnam(sys_get_temp_dir(), 'hyper-escape-');
        $server = false;
        try {
            $server = proc_open([PHP_BINARY, '-d', 'display_errors=0', '-d', 'error_log=/dev/null', '-S', '127.0.0.1:0', __DIR__ . '/Support/escape.php'], [0 => ['file', '/dev/null', 'r'], 1 => ['file', '/dev/null', 'w'], 2 => ['pipe', 'w']], $pipes, null, [...getenv(), 'HYPER_ESCAPE_MODE' => $mode, 'HYPER_ESCAPE_LOG' => $log]);
            if ($server === false) {
                self::fail('the PHP built-in server did not start');
            }
            $started = self::waitFor($pipes[2], 'started');
            if (preg_match('/\(http:\/\/127\.0\.0\.1:(\d+)\) started/', $started, $address) !== 1) {
                self::fail("the server reported no address: {$started}");
            }
            $context = stream_context_create(['http' => ['ignore_errors' => true, 'timeout' => 10]]);
            $stream = fopen("http://127.0.0.1:{$address[1]}/", 'r', false, $context);
            if ($stream === false) {
                self::fail('the PHP built-in server gave no response');
            }
            $body = (string) stream_get_contents($stream);
            // The wrapper data of an HTTP stream holds the status line and the headers of the response.
            $lines = stream_get_meta_data($stream)['wrapper_data'] ?? null;
            fclose($stream);
            if (!is_array($lines) || $lines === []) {
                self::fail('the response had no status line');
            }
            $headers = [];
            foreach ($lines as $line) {
                if (!is_string($line)) {
                    self::fail('a header of the response is not text');
                }
                $headers[] = $line;
            }
            $status = (int) explode(' ', $headers[0])[1];

            return [$status, array_slice($headers, 1), $body, (string) file_get_contents($log)];
        } finally {
            if ($server !== false) {
                proc_terminate($server);
                proc_close($server);
            }
            unlink($log);
        }
    }

    /**
     * Reads the standard error of the PHP built-in server until a line contains the text, for at most 5 seconds, and
     * returns that line.
     *
     * @param resource $stderr
     */
    private static function waitFor($stderr, string $text): string
    {
        $deadline = hrtime(true) + 5_000_000_000;
        $seen = '';
        while (hrtime(true) < $deadline) {
            $read = [$stderr];
            $none = null;
            if (stream_select($read, $none, $none, 0, 200_000) === 1) {
                $line = fgets($stderr);
                if ($line === false) {
                    break;
                }
                $seen .= $line;
                if (str_contains($line, $text)) {
                    return $line;
                }
            }
        }
        self::fail("the server wrote no line with {$text}: {$seen}");
    }
}
