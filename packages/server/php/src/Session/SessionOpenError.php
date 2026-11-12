<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The failure of the open of the session of a request, which escapes the answer of the request instead of being
 * handled as an error of the application (HY-60.14). It keeps the message of the failure that it holds as previous.
 *
 * @internal
 */
final class SessionOpenError extends \RuntimeException
{
}
