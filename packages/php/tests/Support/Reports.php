<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

use Polyspec\Hyper\Reply;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Response;

/** The calls of the response hook of an application (HY-60), which a step records. */
final class Reports
{
    /** @var list<array{0: Request, 1: Response, 2: float, 3: Reply, 4: ?string}> */
    public array $calls = [];

    /** Returns the response hook that records each call. */
    public function hook(): \Closure
    {
        return function (Request $request, Response $response, float $elapsed, Reply $reply, ?string $failure): void {
            $this->calls[] = [$request, $response, $elapsed, $reply, $failure];
        };
    }

    /**
     * Returns each call as the pair of the method and the path of its request, joined by a space, and the status of
     * its response.
     *
     * @return list<array{0: string, 1: int}>
     */
    public function reported(): array
    {
        return array_map(
            static fn (array $call): array => self::reportedCall($call[0], $call[1]),
            $this->calls,
        );
    }

    /**
     * Returns the pair of the method and the path of a request, joined by a space, and the status of its response.
     *
     * @return array{0: string, 1: int}
     */
    private static function reportedCall(Request $request, Response $response): array
    {
        return ["{$request->method} {$request->path()}", $response->status];
    }

    /**
     * Returns the last call, and fails when the hook received none.
     *
     * @return array{0: Request, 1: Response, 2: float, 3: Reply, 4: ?string}
     */
    public function last(): array
    {
        if ($this->calls === []) {
            throw new \LogicException('the response hook received no call');
        }

        return $this->calls[count($this->calls) - 1];
    }
}
