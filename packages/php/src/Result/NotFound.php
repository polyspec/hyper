<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** A resource that does not exist: a loader or an action throws this exception to answer with 404 (HY-27). */
final class NotFound extends \RuntimeException
{
    public function __construct()
    {
        ArgumentCount::most(\func_num_args(), 0);
        parent::__construct('not found');
    }
}
