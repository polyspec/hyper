<?php

declare(strict_types=1);

// The requests of the warning test (HY-74), outside PHPUnit, which lowers error_reporting() while a test runs. It
// answers four JSON requests with the fixture application and prints each status and body as one JSON line.

require __DIR__ . '/../../vendor/autoload.php';

use Polyspec\Hyper\App;
use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Result;

$app = App::open(
    __DIR__ . '/../fixtures/app.json',
    __DIR__ . '/../build/server',
    [
        'routes' => [
            'add' => ['post' => fn (): Result => Result::redirect('/')],
            'item' => ['load' => function (Request $request): array {
                // Reads a key of a map; both requests below read a key that the map does not have.
                $read = static fn (array $values, string $key): mixed => $values[$key];

                return match ($request->param('id')) {
                    'undefined-key' => ['id' => $read([], 'missing')],
                    'user-notice' => (function (): array {
                        trigger_error('a notice of the loader', E_USER_NOTICE);

                        return ['id' => 'notice'];
                    })(),
                    'deprecation' => (function (): array {
                        trigger_error('a deprecation of the loader', E_USER_DEPRECATED);

                        return ['id' => 'deprecation'];
                    })(),
                    default => ['id' => @$read([], 'missing') ?? 'silenced'],
                };
            }],
        ],
    ],
    'Z',
);
$before = set_error_handler(null);
restore_error_handler();
foreach (['undefined-key', 'user-notice', 'deprecation', 'silenced'] as $id) {
    $response = $app->handle(new Request('GET', "/items/{$id}", ['Accept' => 'application/json']), new ArraySession());
    echo json_encode([$id, $response->status, $response->body]), "\n";
}
// The handler of a request is removed after the request.
echo json_encode(['handler', set_error_handler(null) === $before]), "\n";
