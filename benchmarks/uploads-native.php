<?php

declare(strict_types=1);

// The reader of PHP itself for benchmarks/uploads.mts: PHP reads the body into $_POST and $_FILES before this script
// runs, and the script answers the numbers of the entries that it finds there and what its process used. PHP keeps
// the last value of a repeated name and nests bracketed names, so the numbers are not those of the body.

$files = 0;
array_walk_recursive($_FILES, static function (mixed $value, string|int $key) use (&$files): void {
    $files += $key === 'size' || is_int($key) ? 1 : 0;
});
$used = getrusage();
echo json_encode([
    'valid' => true,
    'form' => count($_POST, COUNT_RECURSIVE),
    'files' => $files,
    'held' => 0,
    'cpu' => ($used['ru_utime.tv_sec'] + $used['ru_stime.tv_sec']) * 1000
        + ($used['ru_utime.tv_usec'] + $used['ru_stime.tv_usec']) / 1000,
    'rss' => $used['ru_maxrss'],
], JSON_THROW_ON_ERROR);
