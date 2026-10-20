<?php

declare(strict_types=1);

// The front controller of the disconnect test (HY-67): its shared loader waits, so that the client closes the
// connection first, and its document is larger than a write that a closed connection accepts: the shared title,
// which the document renders, has 1 MiB. The response hook, the write hook and the disconnect hook append a line each
// to the file of HYPER_DISCONNECT_LOG, in the order that the server calls them (HY-99).

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

        return ['title' => str_repeat('x', 1 << 20)];
    },
    onDisconnect: function (Request $request, float $elapsed, Reply $reply) use ($log): void {
        file_put_contents(
            $log,
            sprintf(
                "disconnect %s %s %d %s\n",
                $request->method,
                $request->path,
                $elapsed >= 300.0 ? 1 : 0,
                json_encode($reply->notes()),
            ),
            FILE_APPEND,
        );
    },
)->run();
