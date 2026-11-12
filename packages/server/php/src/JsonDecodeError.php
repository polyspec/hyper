<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server;

/**
 * A JSON text that does not decode as `json_decode` reads it (HY-54).
 *
 * @internal
 */
final class JsonDecodeError extends \InvalidArgumentException
{
}
