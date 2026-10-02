<?php

declare(strict_types=1);

// The front controller of the disconnect test (HY-67): its shared loader waits, so that the client closes the
// connection first, and its document is larger than a write that a closed connection accepts. Both hooks append a
// line to the file of HYPER_DISCONNECT_LOG.

require __DIR__ . '/../../vendor/autoload.php';

use Polyspec\Hyper\App;
use Polyspec\Hyper\Reply;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Response;
use Polyspec\Hyper\Result;

$log = (string) getenv('HYPER_DISCONNECT_LOG');
App::open(
    __DIR__ . '/../fixtures/app.json',
    __DIR__ . '/../build/server',
    [
        'shared' => function (Reply $reply): array {
            $reply->note('stage', 'shared');
            usleep(300_000);

            return ['pad' => str_repeat('x', 1 << 20)];
        },
        'routes' => ['add' => ['post' => fn (): Result => Result::redirect('/')]],
    ],
    'Z',
    onResponse: function (Request $request, Response $response) use ($log): void {
        file_put_contents($log, "response {$response->status}\n", FILE_APPEND);
    },
    onDisconnect: function (Request $request, float $elapsed, Reply $reply) use ($log): void {
        file_put_contents($log, sprintf("disconnect %s %s %d %s\n", $request->method, $request->path, $elapsed >= 300.0 ? 1 : 0, json_encode($reply->notes())), FILE_APPEND);
    },
)->run();
