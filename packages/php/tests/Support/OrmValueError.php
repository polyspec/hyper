<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

/** The error `OrmValueError` of the ORM that a case throws with its kind (HY-107.11). */
final class OrmValueError extends \InvalidArgumentException
{
    use OrmKind;
}
