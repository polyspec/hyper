<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** A loader throws this exception when the requested resource does not exist (HY-27). */
final class NotFound extends \RuntimeException
{
}
