<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** A loader or an action throws this exception to answer the request with 403 (HY-51). */
final class Forbidden extends \RuntimeException
{
}
