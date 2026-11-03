<?php

declare(strict_types=1);

// One PHP server process over one session (tests/scripts/session-workers.mts): the arguments are the session directory,
// the identifier, and `count <requests> <name>`, `read <names as JSON>`, `write <values as JSON>` or `stale`, which
// writes a value and closes after a line of its input. With HYPER_SESSION_REDIS, the port of a Redis server, it keeps
// the session there through phpredis; HYPER_SESSION_SENTINEL names the ports of Sentinels instead, and
// HYPER_SESSION_TLS_CA, HYPER_SESSION_USER and HYPER_SESSION_PASSWORD secure the connection;
// HYPER_SESSION_PERSISTENT keeps one connection for the requests of the process.

require __DIR__ . '/../../../../vendor/autoload.php';

use Polyspec\Hyper\NativeSession;
use Polyspec\Hyper\RedisSentinelSessions;

[, $directory, $identifier, $command, $first, $second] = [...$argv, null, null];
$port = getenv('HYPER_SESSION_REDIS');
$sentinels = getenv('HYPER_SESSION_SENTINEL');
$setup = null;
if ($port !== false || $sentinels !== false) {
    ini_set('session.save_handler', 'redis');
    $ca = getenv('HYPER_SESSION_TLS_CA');
    $user = getenv('HYPER_SESSION_USER');
    $password = getenv('HYPER_SESSION_PASSWORD');
    $parameters = [
        ...($user === false ? [] : ['auth[]=' . urlencode($user), 'auth[]=' . urlencode((string) $password)]),
        ...($ca === false ? [] : ['stream[cafile]=' . urlencode($ca)]),
        ...(getenv('HYPER_SESSION_PERSISTENT') === false ? [] : ['persistent=1']),
    ];
    $query = $parameters === [] ? '' : '?' . implode('&', $parameters);
    ini_set('session.save_path', ($ca === false ? 'tcp' : 'tls') . "://127.0.0.1:{$port}{$query}");
    ini_set('redis.session.locking_enabled', '1');
    ini_set('redis.session.lock_expire', getenv('HYPER_SESSION_EXPIRE') ?: '30');
    ini_set('redis.session.lock_retries', getenv('HYPER_SESSION_RETRIES') ?: '-1');
    ini_set('redis.session.lock_wait_time', '2000');
    if ($sentinels !== false) {
        $setup = (new RedisSentinelSessions(array_map(
            static fn (string $item): array => [
                'host' => '127.0.0.1',
                'port' => (int) $item,
                ...($user === false ? [] : ['auth' => [$user, (string) $password]]),
                ...($ca === false ? [] : ['ssl' => ['cafile' => $ca]]),
            ],
            explode(',', $sentinels),
        ), 'hyper', $query, $ca === false ? 'tcp' : 'tls'))(...);
    }
} else {
    ini_set('session.save_path', $directory);
}

/** Runs one request with a session store; closing the PHP session ends the request. */
$request = static function (callable $use) use ($identifier, $setup): mixed {
    $_COOKIE['hy-session'] = $identifier;
    $result = $use(new NativeSession(false, $setup));
    session_write_close();

    return $result;
};

/** Returns the value as JSON of the test: a map as {"map": [[key, value], ...]}, whatever server wrote it. */
$canonical = static function (mixed $value) use (&$canonical): mixed {
    $map = $value instanceof \stdClass;
    if ($map) {
        $value = get_object_vars($value);
    }
    if (!is_array($value)) {
        return $value;
    }
    if (!$map && array_is_list($value)) {
        return array_map($canonical, $value);
    }
    $entries = [];
    foreach ($value as $key => $item) {
        $entries[] = [(string) $key, $canonical($item)];
    }

    return ['map' => $entries];
};

if ($command === 'count') {
    for ($index = 0; $index < (int) $first; $index++) {
        $request(static function (NativeSession $store) use ($second): void {
            $store->set('n', $store->get('n') + 1);
            $store->set($second, ($store->get($second) ?? 0) + 1);
        });
    }
} elseif ($command === 'stale') {
    $request(static function (NativeSession $store): void {
        $store->set('n', $store->get('n') + 1);
        $store->set('stale', 1);
        echo "holding\n";
        fgets(STDIN);
    });
} elseif ($command === 'read') {
    $names = json_decode($first, true, 512, JSON_THROW_ON_ERROR);
    echo json_encode($request(static fn (NativeSession $store): array => array_map(
        static fn (string $name): mixed => $canonical($store->get($name)),
        $names,
    )), JSON_THROW_ON_ERROR);
} else {
    $values = json_decode($first, false, 512, JSON_THROW_ON_ERROR);
    $request(static function (NativeSession $store) use ($values): void {
        foreach (get_object_vars($values) as $name => $value) {
            $store->set($name, $value);
        }
    });
}
