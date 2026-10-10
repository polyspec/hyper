<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The write of the response of one PHP request, which `App::run` keeps for the write hook (HY-99): the response whose
 * write started, or the plain 500 of an escaped error, the failure of that error, and whether the write was complete.
 */
final class Delivery
{
    /** The response whose write started, or null while no write started. */
    public ?Response $response = null;

    /** The message of an escaped error (HY-43), or null. */
    public ?string $failure = null;

    /** False when the write of the response cannot be complete, because headers were sent before a failure. */
    public bool $complete = true;
}
