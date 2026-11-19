<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * Answers the current PHP request with the application `$app` by calling `App::serve`. This host function is the entry
 * that the front controller loads with `use function`; it is not a public member of `App` (HY-106.20).
 */
function run(App $app, ?int $started = null): void
{
    ArgumentCount::most(\func_num_args(), 2);
    $app->serve($started);
}
