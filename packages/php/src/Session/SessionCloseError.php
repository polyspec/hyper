<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The failure of the close of the session of a request, such as a write that the save handler refuses because the
 * request lost its lock (HY-115.23). It escapes the answer of the request instead of being handled as an error of the
 * application (HY-60.14), and keeps the failure that it holds as previous.
 *
 * @internal
 */
final class SessionCloseError extends \RuntimeException
{
}
