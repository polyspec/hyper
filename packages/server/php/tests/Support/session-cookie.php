<?php

declare(strict_types=1);

// The page of SessionCookieTest: one request of the session of HY-45 over HTTP. `mode` is write (sets a value), read
// (reads a value) or renew (regenerates the identifier after a read), `https=1` declares that the application is served
// over HTTPS, and the response body is the identifier of the session. `mode=fail` installs a save handler whose open
// refuses, so the session cannot start.

require __DIR__ . '/../../../../../vendor/autoload.php';

use Polyspec\Hyper\NativeSession;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Tests\Support\RefusingSessionHandler;

$setup = null;
if (($_GET['mode'] ?? '') === 'fail') {
    $setup = static function (): void {
        session_set_save_handler(new RefusingSessionHandler(false), false);
    };
}
$store = new NativeSession(isset($_GET['https']), Request::fromGlobals(), $setup);
switch ($_GET['mode'] ?? '') {
    case 'fail':
        $store->get('a');
        break;
    case 'write':
        $store->set('a', 1);
        break;
    case 'read':
        $store->get('a');
        break;
    case 'renew':
        $store->get('a');
        $store->renew();
        break;
    default:
        http_response_code(400);
        exit;
}
echo session_id();
