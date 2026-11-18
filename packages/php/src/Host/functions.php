<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * Answers the current PHP request with the application `$app` and writes the response: the entry of the front
 * controller (HY-100.30). The host entries are functions of the host code that take the application first, and no
 * members of `App`, because the host code is written by hand for each runtime and `App` follows the interface
 * contract (HY-106.20). The elapsed time of HY-60 counts from `$started`, an hrtime(true) value of the monotonic clock
 * that the caller takes at the start of the request, and defaults to now.
 */
function run(App $app, ?int $started = null): void
{
    ArgumentCount::most(\func_num_args(), 2);
    $app->serve($started);
}
