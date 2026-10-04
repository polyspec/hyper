<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * Declares the client-rendered pages of an application (HY-62): the static shell that answers their HTML requests,
 * the base path of their JSON requests and actions, and the selection that chooses their requests.
 */
final class ClientRendering
{
    /**
     * @param string $shell the absolute path of the static shell, which declares the base path with
     *     `<meta name="hyper-api">` (HY-22)
     * @param string $basePath the data base path, such as `/_props` (HY-8)
     * @param \Closure(Request): mixed $selects returns a Choice: whether the request is of a client-rendered page, and
     *     the value that every loader and action of the request reads with `Request::selection()`; another value
     *     fails the request with HY-43
     */
    public function __construct(
        public readonly string $shell,
        public readonly string $basePath,
        public readonly \Closure $selects,
    ) {
    }
}
