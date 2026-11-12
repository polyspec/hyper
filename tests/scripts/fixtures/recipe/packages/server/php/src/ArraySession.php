<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server;

/**
 * A session store kept in memory, which implements the interface of a later file.
 *
 * @internal
 */
final class ArraySession implements SessionStore
{
    public function read(string $id): ?string
    {
        return (new Csrf('k'))->check() ? null : $id;
    }
}
