<?php

declare(strict_types=1);

// Errors go to the log. PHP startup warnings appear before this line runs, so the server must also
// start with display_errors off (HY-43).
ini_set('display_errors', '0');

use Polyspec\Hyper\App;
use Polyspec\Hyper\Examples\Board\Assets;
use Polyspec\Hyper\Examples\Board\Posts;
use Polyspec\Hyper\RedisClusterSessions;
use Polyspec\Hyper\RedisSentinelSessions;

require __DIR__ . '/../vendor/autoload.php';

$database = getenv('BOARD_DB');
if (!is_string($database) || $database === '') {
    throw new RuntimeException('BOARD_DB must name the SQLite database file');
}
// Server-side rendering serves the application at the root; the data server of client-side rendering uses /api.
$basePath = getenv('BOARD_BASE_PATH');
// BOARD_TIME fixes the creation time of new posts in Unix seconds, so that two servers store the same posts
// (`make server-parity`); without it a post has the current time.
$time = getenv('BOARD_TIME');
if (is_string($time) && $time !== '' && preg_match('/^[0-9]{1,15}$/D', $time) !== 1) {
    throw new RuntimeException('BOARD_TIME must be Unix seconds');
}
$now = is_string($time) && $time !== '' ? fn (): int => (int) $time : fn (): int => time();
// BOARD_SENTINEL, `host:port` of each Sentinel separated by commas, keeps the sessions on the primary hyper that they
// name, and BOARD_CLUSTER, `host:port` of nodes of a Redis Cluster separated by commas, keeps them on that cluster.
$sentinels = getenv('BOARD_SENTINEL');
$cluster = getenv('BOARD_CLUSTER');
$sessionSetup = is_string($cluster) && $cluster !== ''
    ? (new RedisClusterSessions(explode(',', $cluster)))(...)
    : null;
$sessionSetup ??= is_string($sentinels) && $sentinels !== ''
    ? (new RedisSentinelSessions(array_map(
        static function (string $item): array {
            [$host, $port] = explode(':', $item);

            return ['host' => $host, 'port' => (int) $port];
        },
        explode(',', $sentinels),
    ), 'hyper', '?persistent=1'))(...)
    : null;
// BOARD_HTTPS=1 declares HTTPS behind a TLS-terminating proxy; BOARD_FRAME_ANCESTORS sets frame-ancestors (HY-45).
$frameAncestors = getenv('BOARD_FRAME_ANCESTORS');

$app = App::open(
    manifest: __DIR__ . '/../app/app.json',
    // `make server` builds the program; PHP renders with the native extension when it has loaded it (HY-48).
    program: __DIR__ . '/../build/server',
    handlers: require __DIR__ . '/../app/handlers.php',
    timezone: '+09:00',
    // The form of a new post is multipart, because it holds a file (HY-59.6, HY-131).
    formTypes: ['application/x-www-form-urlencoded', 'multipart/form-data'],
    basePath: is_string($basePath) ? $basePath : '',
    https: getenv('BOARD_HTTPS') === '1',
    sessionSetup: $sessionSetup,
    frameAncestors: is_string($frameAncestors) && $frameAncestors !== '' ? $frameAncestors : "'self'",
    // The context of every page (HY-124): the name of the site, which the title template reads.
    context: static fn (mixed $selection): array => ['site' => ['name' => '게시판 예제']],
);
$app->bind(Posts::class, fn (): Posts => new Posts($database, $now));
$app->bind(Assets::class, fn (): Assets => Assets::fromManifest(__DIR__ . '/../build/manifest.json'));
$app->run();
