<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

/** The error `OrmStoreError` of the ORM that a case throws with its kind (HY-107.11). */
final class OrmStoreError extends \RuntimeException
{
    use OrmKind;
}
