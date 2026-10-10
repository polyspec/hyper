<?php

declare(strict_types=1);

// The front controller of the escape tests (HY-60). HYPER_ESCAPE_MODE selects where the request fails: `fatal` exhausts
// the memory limit in the shared loader, before the response hook runs; `hook-fatal` raises E_USER_ERROR in the
// response hook; `hook-throws` throws from the response hook. Every response hook call appends a line to the file of
// HYPER_ESCAPE_LOG, so a test reads how often the hook ran.

require __DIR__ . '/../../../../vendor/autoload.php';

use Polyspec\Hyper\App;
use Polyspec\Hyper\Reply;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Response;
use Polyspec\Hyper\Result;

$mode = (string) getenv('HYPER_ESCAPE_MODE');
$log = (string) getenv('HYPER_ESCAPE_LOG');
App::open(
    __DIR__ . '/../fixtures/app.json',
    __DIR__ . '/../build/server',
    [
        'shared' => function (Reply $reply) use ($mode): array {
            if ($mode === 'fatal') {
                ini_set('memory_limit', '8M');
                $memory = str_repeat('x', 16 * 1024 * 1024);
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
)->run();
