<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** A loader or an action throws this exception to answer the request with 400 (HY-58). */
final class BadRequest extends \RuntimeException
{
}
