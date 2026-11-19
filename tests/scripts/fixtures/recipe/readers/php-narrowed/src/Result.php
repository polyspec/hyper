<?php

declare(strict_types=1);

namespace Fixture\Readers;

/** The result of an action, which a redirect of its location answers (HY-50). */
final class Result
{
    public function __construct(private ?string $location)
    {
    }

    public function isRedirect(): bool
    {
        return $this->location !== null;
    }
}
