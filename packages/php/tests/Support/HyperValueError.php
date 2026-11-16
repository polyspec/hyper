<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

/**
 * An error of the category `value` (HY-132.2) for the tests of CaseRules, with the same constructor under the generated
 * program and under the native extension, whose classes of hyper take their arguments in different orders.
 */
final class HyperValueError extends \InvalidArgumentException
{
    public function __construct(private readonly string $kind, string $message)
    {
        parent::__construct($message);
    }

    public function kind(): string
    {
        return $this->kind;
    }
}
