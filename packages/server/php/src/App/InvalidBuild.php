<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * A `build.json` that is missing, is not valid JSON or does not hold exactly the key `build` with a build id of 64
 * lowercase hexadecimal characters; the message names the path of the file, and the application does not open
 * (HY-125.5).
 *
 * @internal
 */
final class InvalidBuild extends \InvalidArgumentException
{
}
