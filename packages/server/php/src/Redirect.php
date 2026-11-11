<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** A loader or an action throws this exception to answer the request with the redirect of a result (HY-50). */
final class Redirect extends \RuntimeException
{
    /** Fails for a result that is not a redirect. */
    public function __construct(public readonly Result $result)
    {
        if (!$result->isRedirect()) {
            throw new \InvalidArgumentException('a redirect stop needs a redirect result (HY-50)');
        }
        parent::__construct("redirect to {$result->location}");
    }
}
