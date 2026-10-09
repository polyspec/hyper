<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The result of the selection of a client rendering (HY-62): whether the request is of a client-rendered page, and a
 * value that every loader and action of the request reads with `Request::selection()`.
 */
final class Choice
{
    public function __construct(
        public readonly bool $chosen,
        public readonly mixed $value,
    ) {
    }
}
