<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server;

/**
 * An Accept value that does not follow the grammar of RFC 9110, section 12.5.1, or that has a weight that is not a
 * qvalue; the server answers it with status 400 (HY-116.5).
 *
 * @internal
 */
final class InvalidAccept extends \InvalidArgumentException
{
}
