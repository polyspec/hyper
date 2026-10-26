<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

use Polyspec\Hyper\App;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Response;
use Polyspec\Hyper\Result;

/**
 * The application of the front controllers of the disconnect and escape tests: the fixtures with a route `add`, a
 * response hook that appends a `response` line to the log and a write hook that appends a `written` line (HY-99).
 */
final class FrontController
{
    /**
     * Opens the application with the shared handler `$shared`; `$afterResponse` runs after the response line was
     * appended, `$onDisconnect` is the disconnect hook and `$around` the request hook (HY-97).
     */
    public static function open(
        string $log,
        \Closure $shared,
        ?\Closure $afterResponse = null,
        ?\Closure $onDisconnect = null,
        ?\Closure $around = null,
    ): App {
        return App::open(
            __DIR__ . '/../fixtures/app.json',
            __DIR__ . '/../build/server',
            [
                'shared' => $shared,
                'routes' => ['add' => ['post' => fn (): Result => Result::redirect('/')]],
            ],
            'Z',
            onResponse: function (Request $request, Response $response) use ($log, $afterResponse): void {
                file_put_contents($log, "response {$response->status}\n", FILE_APPEND);
                if ($afterResponse !== null) {
                    $afterResponse();
                }
            },
            onDisconnect: $onDisconnect,
            around: $around,
            written: function (
                Request $request,
                ?Response $response,
                bool $ended,
                float $elapsed,
                ?string $failure,
            ) use ($log): void {
                file_put_contents(
                    $log,
                    sprintf(
                        "written %s %s %s\n",
                        $response === null ? 'null' : $response->status,
                        $ended ? 'true' : 'false',
                        json_encode($failure),
                    ),
                    FILE_APPEND,
                );
            },
        );
    }
}
