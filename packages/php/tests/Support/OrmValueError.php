<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

/**
 * An error of category value of the orm binding, which a case names by its class and its kind (HY-107.7); hyper has
 * no orm package among its test dependencies, so the test gives the class its name, its base and its kind.
 */
final class OrmValueError extends \InvalidArgumentException
{
    public readonly ?int $status;

    public function __construct(public readonly string $kind)
    {
        parent::__construct($kind . ': a failure of the ORM');
        $this->status = null;
    }
}
