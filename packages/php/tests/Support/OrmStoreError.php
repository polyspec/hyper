<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

/**
 * An error of the ORM that a case throws as `OrmStoreError` with its kind (HY-107.11): hyper does not depend on the orm
 * package, and the server knows an error of the ORM by the name of its class and by the kind that `kind()` gives.
 */
final class OrmStoreError extends \RuntimeException
{
    public function __construct(private readonly string $kind)
    {
        parent::__construct($kind . ': a failure of the ORM');
    }

    public function kind(): string
    {
        return $this->kind;
    }
}
