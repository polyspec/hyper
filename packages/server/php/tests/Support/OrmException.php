<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

/** An error shaped like the OrmException of polyspec/orm, which hyper identifies by its class name and its code (HY-107). */
final class OrmException extends \RuntimeException
{
    public function __construct(public readonly string $code_)
    {
        parent::__construct($code_ . ': a failure of the ORM');
    }
}
