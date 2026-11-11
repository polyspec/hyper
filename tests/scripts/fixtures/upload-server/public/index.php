<?php

declare(strict_types=1);

// The PHP server of tests/scripts/upload-servers.test.mts: `App::run` under a SAPI, with the application that the
// test built in UPLOAD_APP. The request hook answers every request with what the request gave of its body as JSON:
// whether its input is valid, its form values, and the name, the filename, the content type, the size and the SHA-256
// digest of each file, which it moves into UPLOAD_MOVED, reads and removes; `held` is the number of directories of
// requests in the temporary directory while the request runs.

use Polyspec\Hyper\App;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Response;

$loader = require dirname(__DIR__, 5) . '/vendor/autoload.php';

$application = (string) getenv('UPLOAD_APP');
$moved = (string) getenv('UPLOAD_MOVED');
$limit = (int) getenv('UPLOAD_LIMIT');
// The autoloader of Composer maps the namespace of the server program to its directory php, as autoload.psr-4 of an
// application does.
$program = json_decode((string) file_get_contents("{$application}/program/program.json"), true, 4, JSON_THROW_ON_ERROR);
$loader->addPsr4("{$program['namespace']}\\", "{$application}/program/php");
App::open(
    manifest: "{$application}/manifest.json",
    program: "{$application}/program",
    handlers: ['routes' => ['home' => ['load' => static fn (): array => []]]],
    timezone: 'Z',
    bodyLimit: $limit,
    formTypes: ['application/x-www-form-urlencoded', 'multipart/form-data'],
    fileLimit: $limit,
    partLimit: (int) (getenv('UPLOAD_PARTS') ?: 1000),
    around: static function (Request $request) use ($moved): Response {
        // UPLOAD_USAGE=1 is the form of benchmarks/uploads.mts: the sizes of the files without a move, and the
        // processor time and the largest memory of the process.
        $usage = getenv('UPLOAD_USAGE') === '1';
        $files = [];
        foreach ($request->files() as [$name, $list]) {
            foreach ($list as $file) {
                if ($usage) {
                    $files[] = [$name, $file->size()];
                    continue;
                }
                $target = "{$moved}/php-" . count($files);
                $file->moveTo($target);
                $digest = hash_file('sha256', $target);
                $files[] = [$name, $file->filename(), $file->contentType(), $file->size(), $digest];
                unlink($target);
            }
        }
        $answer = [
            'valid' => $request->validInput(),
            'form' => $request->form(),
            'files' => $files,
            'held' => count(glob(sys_get_temp_dir() . '/hyper-*') ?: []),
        ];
        if ($usage) {
            $used = getrusage();
            $answer['cpu'] = ($used['ru_utime.tv_sec'] + $used['ru_stime.tv_sec']) * 1000
                + ($used['ru_utime.tv_usec'] + $used['ru_stime.tv_usec']) / 1000;
            $answer['rss'] = $used['ru_maxrss'];
        }

        return Response::text(200, json_encode($answer, JSON_THROW_ON_ERROR));
    },
)->run();
