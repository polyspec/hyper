<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

/** A service that the fixture application reads and changes. */
final class Counter
{
    public int $count = 0;
    public int $actions = 0;
}
