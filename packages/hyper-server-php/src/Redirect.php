<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** A loader or an action throws this exception to answer the request with the redirect of a result (HY-50). */
final class Redirect extends \RuntimeException
{
    public function __construct(public readonly Result $result)
    {
        if (!$result->isRedirect()) {
            throw new \InvalidArgumentException('a redirect needs a redirect result');
        }
        parent::__construct("redirect to {$result->location}");
    }
}
