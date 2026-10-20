<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** A malformed request: a loader or an action throws this exception to answer with 400 (HY-58). */
final class BadRequest extends \RuntimeException
{
}
