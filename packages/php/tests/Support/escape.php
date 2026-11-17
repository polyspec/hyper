<?php

declare(strict_types=1);

// The front controller of the escape tests (HY-60). HYPER_ESCAPE_MODE selects where the request fails: `fatal` exhausts
// the memory limit in the shared loader, before the response hook runs; `time-limit` exceeds max_execution_time in the
// shared loader; `hook-fatal` raises E_USER_ERROR in the response hook; `after-send` raises E_USER_ERROR after App::run
// sent the response, `after-send-flushed` flushes the output first; `exit` ends the script with exit() in the shared
// loader, before any output; `read-fails` replaces the `php` stream wrapper with one whose read of php://input fails,
// so that App::run fails while it reads the body (HY-60.14). Every response hook call appends a `response` line and every write hook call appends a
// `written` line to the file of HYPER_ESCAPE_LOG, so a test reads how often each hook ran and in which order.

require __DIR__ . '/../../../../vendor/autoload.php';
require_once __DIR__ . '/FrontController.php';

use Polyspec\Hyper\Reply;
use Polyspec\Hyper\Tests\Support\FrontController;

/** A `php` stream wrapper whose stream opens and whose every read fails, as a read of a broken input does. */
final class FailingInput
{
    /** @var resource|null set by PHP for a stream wrapper */
    public $context;

    public function stream_open(string $path, string $mode, int $options, ?string &$opened): bool
    {
        return true;
    }

    public function stream_read(int $count): false
    {
        return false;
    }

    public function stream_eof(): bool
    {
        return false;
    }

    public function stream_close(): void
    {
    }
}

$mode = (string) getenv('HYPER_ESCAPE_MODE');
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
);
if ($mode === 'read-fails') {
    stream_wrapper_unregister('php');
    stream_wrapper_register('php', FailingInput::class);
}
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
