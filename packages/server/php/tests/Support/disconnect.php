<?php

declare(strict_types=1);

// The front controller of the disconnect test (HY-67): its shared loader waits, so that the client closes the
// connection first, then writes 1 MiB to the closed connection, which ends the script during the answer. The write
// hook and the disconnect hook append a line each to the file of HYPER_DISCONNECT_LOG, in the order that the server
// calls them (HY-99).

require __DIR__ . '/../../../../../vendor/autoload.php';
require_once __DIR__ . '/FrontController.php';

use Polyspec\Hyper\Reply;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Tests\Support\FrontController;

$log = (string) getenv('HYPER_DISCONNECT_LOG');
FrontController::open(
    $log,
    function (Reply $reply): array {
        $reply->note('stage', 'shared');
        usleep(300_000);
        echo str_repeat('x', 1 << 20);
        flush();
        exit();
    },
    onDisconnect: function (Request $request, float $elapsed, Reply $reply) use ($log): void {
        file_put_contents(
            $log,
            sprintf(
                "disconnect %s %s %d %s\n",
                $request->method,
                $request->path(),
                $elapsed >= 300.0 ? 1 : 0,
                json_encode(array_column($reply->notes(), 1, 0)),
            ),
            FILE_APPEND,
        );
    },
)->run();
