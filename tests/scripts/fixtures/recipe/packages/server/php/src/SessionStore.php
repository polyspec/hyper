<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server;

/**
 * The session store of HY-3.
 *
 * @internal
 */
interface SessionStore
{
    public function read(string $id): ?string;
}
