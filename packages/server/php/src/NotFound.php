<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** A loader or an action throws this exception when the requested resource does not exist (HY-27). */
final class NotFound extends \RuntimeException
{
    public function __construct()
    {
        parent::__construct('not found');
    }
}
