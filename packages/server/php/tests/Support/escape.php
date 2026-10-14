<?php

declare(strict_types=1);

// The front controller of the escape tests (HY-60). HYPER_ESCAPE_MODE selects where the request fails: `fatal` exhausts
// the memory limit in the shared loader, before the response hook runs; `time-limit` exceeds max_execution_time in the
// shared loader; `hook-fatal` raises E_USER_ERROR in the response hook; `hook-throws` throws from the response hook;
// `after-send` raises E_USER_ERROR after App::run sent the response, `after-send-flushed` flushes the output first;
// `exit` ends the script with exit() in the shared loader, before any output; `normal` fails nothing. Every response hook call
// appends a `response` line and every write hook call appends a `written` line to the file of HYPER_ESCAPE_LOG, so a
// test reads how often each hook ran and in which order. HYPER_ESCAPE_HEADER=1 sets the header X-Before before App::run.

require __DIR__ . '/../../../../../vendor/autoload.php';

use Polyspec\Hyper\App;
use Polyspec\Hyper\Reply;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Response;
use Polyspec\Hyper\Result;

$mode = (string) getenv('HYPER_ESCAPE_MODE');
$log = (string) getenv('HYPER_ESCAPE_LOG');
if (getenv('HYPER_ESCAPE_HEADER') === '1') {
    header('X-Before: kept');
}
$app = App::open(
    __DIR__ . '/../fixtures/app.json',
    __DIR__ . '/../build/server',
    [
        'shared' => function (Reply $reply) use ($mode): array {
            if ($mode === 'fatal') {
                ini_set('memory_limit', '8M');
                $memory = str_repeat('x', 16 * 1024 * 1024);
            }
            if ($mode === 'exit') {
                exit;
            }
            if ($mode === 'time-limit') {
                set_time_limit(1);
                while (microtime(true) > 0.0) {
                    $spin = 1;
                }
            }

            return ['title' => 'Home'];
        },
        'routes' => ['add' => ['post' => fn (): Result => Result::redirect('/')]],
    ],
    'Z',
    onResponse: function (Request $request, Response $response) use ($mode, $log): void {
        file_put_contents($log, "response {$response->status}\n", FILE_APPEND);
        if ($mode === 'hook-fatal') {
            trigger_error('a fatal error of the response hook', E_USER_ERROR);
        }
        if ($mode === 'hook-throws') {
            throw new RuntimeException('a response hook that throws');
        }
    },
    written: function (Request $request, ?Response $response, bool $ended, float $elapsed, ?string $failure) use ($log): void {
        file_put_contents($log, sprintf("written %s %s %s\n", $response === null ? 'null' : $response->status, $ended ? 'true' : 'false', json_encode($failure)), FILE_APPEND);
    },
);
$app->run();
if ($mode === 'after-send-flushed') {
    while (ob_get_level() > 0) {
        ob_end_flush();
    }
    flush();
}
if ($mode === 'after-send' || $mode === 'after-send-flushed') {
    trigger_error('after the response', E_USER_ERROR);
}
