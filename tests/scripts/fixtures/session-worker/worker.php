<?php

declare(strict_types=1);

// One PHP server process over one session (tests/scripts/session-shared.test.mts): the arguments are the session
// directory, the identifier, and `count <requests> <name>`, `read <names as JSON>` or `write <values as JSON>`.

require __DIR__ . '/../../../../vendor/autoload.php';

use Polyspec\Hyper\NativeSession;

[, $directory, $identifier, $command, $first, $second] = [...$argv, null, null];
ini_set('session.save_path', $directory);

/** Runs one request with a session store; closing the PHP session ends the request. */
$request = static function (callable $use) use ($identifier): mixed {
    $_COOKIE['hy-session'] = $identifier;
    $result = $use(new NativeSession(false));
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
