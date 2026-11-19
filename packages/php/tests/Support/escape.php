<?php

declare(strict_types=1);

// The front controller of the escape tests (HY-60). HYPER_ESCAPE_MODE selects where the request fails: `fatal` exhausts
// the memory limit in the shared loader, before the response hook runs; `time-limit` exceeds max_execution_time in the
// shared loader; `hook-fatal` raises E_USER_ERROR in the response hook; `after-send` raises E_USER_ERROR after App::run
// sent the response, `after-send-flushed` flushes the output first; `exit` ends the script with exit() in the shared
// loader, before any output; `read-fails` replaces the `php` stream wrapper with one whose read of php://input fails,
// so that `run` fails while it reads the body (HY-60.14); `read-fails-multipart` accepts multipart/form-data and
// gives the head of a file part before the read fails, so that the request has a directory (HY-131.14);
// `session-write-fails` keeps the session with a handler whose write fails, as phpredis does for a request that lost
// its lock (HY-115.23). Every response hook call appends a `response` line and every write hook call appends a
// `written` line to the file of HYPER_ESCAPE_LOG, so a test reads how often each hook ran and in which order.

require __DIR__ . '/../../../../vendor/autoload.php';
require_once __DIR__ . '/FrontController.php';

use Polyspec\Hyper\Reply;
use Polyspec\Hyper\Tests\Support\FailingInput;
use Polyspec\Hyper\Tests\Support\FailingWriteSessionHandler;
use Polyspec\Hyper\Tests\Support\FrontController;

use function Polyspec\Hyper\run;

$mode = (string) getenv('HYPER_ESCAPE_MODE');
if ($mode === 'session-write-fails') {
    session_set_save_handler(new FailingWriteSessionHandler());
}
$log = (string) getenv('HYPER_ESCAPE_LOG');
$app = FrontController::open(
    $log,
    function (Reply $reply) use ($mode): array {
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
    function () use ($mode): void {
        if ($mode === 'hook-fatal') {
            trigger_error('a fatal error of the response hook', E_USER_ERROR);
        }
    },
    formTypes: $mode === 'read-fails-multipart'
        ? ['application/x-www-form-urlencoded', 'multipart/form-data']
        : ['application/x-www-form-urlencoded'],
);
if ($mode === 'read-fails' || $mode === 'read-fails-multipart') {
    if ($mode === 'read-fails-multipart') {
        // The head of a file part of the body that the test sends with the boundary `b`; its content never ends.
        FailingInput::$head = "--b\r\nContent-Disposition: form-data; name=\"f\"; filename=\"a.txt\"\r\n"
            . "Content-Type: text/plain\r\n\r\nthe start of the file";
    }
    stream_wrapper_unregister('php');
    stream_wrapper_register('php', FailingInput::class);
}
run($app);
if ($mode === 'after-send-flushed') {
    while (ob_get_level() > 0) {
        ob_end_flush();
    }
    flush();
}
if ($mode === 'after-send' || $mode === 'after-send-flushed') {
    trigger_error('after the response', E_USER_ERROR);
}
