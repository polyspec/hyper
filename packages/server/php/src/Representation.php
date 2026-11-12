<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server;

/**
 * The response of a representation handler (HY-122): a status, a body that is a value of the data model or null for
 * no body, and headers. The server checks the response (HY-122) before it sends it.
 */
final class Representation
{
    /** @param array<string, mixed> $headers the headers by name, whose values the server checks (HY-122) */
    public function __construct(
        public readonly int $status,
        public readonly mixed $body = null,
        public readonly array $headers = [],
    ) {
        ArgumentCount::most(\func_num_args(), 3);
    }
}
