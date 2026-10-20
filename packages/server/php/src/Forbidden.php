<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** A refused request: a loader or an action throws this exception to answer with 403 (HY-51). */
final class Forbidden extends \RuntimeException
{
}
