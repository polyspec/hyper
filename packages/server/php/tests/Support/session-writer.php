<?php

declare(strict_types=1);

// A process that adds one to the value `n` of one PHP session and holds the session for 100 ms between the read and the
// write, so that two processes without the lock of the session file would lose an update (HY-104). The session
// directory comes from HYPER_SESSION_DIRECTORY and the identifier of an existing session from HYPER_SESSION_ID; the
// process prints the identifier of its session.

require __DIR__ . '/../../../../../vendor/autoload.php';

use Polyspec\Hyper\NativeSession;

ini_set('session.save_path', (string) getenv('HYPER_SESSION_DIRECTORY'));
if (getenv('HYPER_SESSION_ID') !== false) {
    $_COOKIE['hy-session'] = (string) getenv('HYPER_SESSION_ID');
}
$store = new NativeSession(false);
$count = $store->get('n');
usleep(100_000);
$store->set('n', (is_int($count) ? $count : 0) + 1);
echo session_id();
