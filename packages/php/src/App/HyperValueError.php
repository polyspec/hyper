<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * An error of the category `value` (HY-132.2): it gives its kind, which a caller tells failures apart by, and no
 * status.
 *
 * @internal
 */
final class HyperValueError extends \InvalidArgumentException
{
    public function __construct(private readonly string $kind, string $message)
    {
        parent::__construct($message);
    }

    /** The kind of the failure (HY-132.1). */
    public function kind(): string
    {
        return $this->kind;
    }

    /** The HTTP status of the failure, which an error of the category `value` does not have (HY-132.1). */
    public function status(): ?int
    {
        return null;
    }
}
