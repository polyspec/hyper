<?php

declare(strict_types=1);

// One PHP process that reads the request bodies of a list (tests/scripts/multipart-compare.test.mts): the arguments
// are the list, a JSON file of objects with `body`, the path of the body, `type`, `chunk`, `limit`, `valueLimit`,
// `partLimit` and `fileLimit`, and a directory for the files that it moves. It prints one JSON line for each body: what
// the body gave, a digest of the names, the values, the filenames and the contents of the files, and what it used.

require dirname(__DIR__, 4) . '/vendor/autoload.php';

use Polyspec\Hyper\Server\RequestBody;

$cases = json_decode((string) file_get_contents($argv[1]), true, 16, JSON_THROW_ON_ERROR);
foreach ($cases as $index => $case) {
    $started = hrtime(true);
    $read = new RequestBody(
        $case['type'],
        $case['limit'],
        true,
        $case['valueLimit'],
        $case['partLimit'],
        $case['fileLimit'],
    );
    $input = fopen($case['body'], 'rb');
    $stopped = false;
    while (!$stopped && !feof($input)) {
        $chunk = (string) fread($input, $case['chunk']);
        if ($chunk !== '') {
            $stopped = !$read->feed($chunk);
        }
    }
    fclose($input);
    $parts = $read->parts();
    $ms = (hrtime(true) - $started) / 1e6;
    $hash = hash_init('sha256');
    $values = 0;
    $files = 0;
    $bytes = 0;
    if ($parts !== null) {
        foreach ($parts[0]->pairs() as [$name, $list]) {
            hash_update($hash, "V\0{$name}\0");
            foreach ($list as $value) {
                $values++;
                hash_update($hash, strlen($value) . "\0{$value}\0");
            }
        }
        foreach ($parts[1]->pairs() as [$name, $list]) {
            foreach ($list as $file) {
                $files++;
                $bytes += $file->size();
                $target = "{$argv[2]}/php-{$index}-{$files}";
                $file->moveTo($target);
                $described = "F\0{$name}\0{$file->filename()}\0{$file->contentType()}\0{$file->size()}\0";
                hash_update($hash, $described . hash_file('sha256', $target) . "\0");
                unlink($target);
            }
        }
    }
    $read->remove();
    $usage = getrusage();
    echo json_encode([
        'result' => [$parts !== null, $stopped, $read->exceeded(), $values, $files, $bytes, hash_final($hash)],
        'ms' => round($ms, 1),
        'cpu' => round(
            ($usage['ru_utime.tv_sec'] + $usage['ru_stime.tv_sec']) * 1000
            + ($usage['ru_utime.tv_usec'] + $usage['ru_stime.tv_usec']) / 1000,
        ),
    ]), "\n";
}
