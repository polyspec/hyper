<?php

declare(strict_types=1);

// The PHP server of tests/scripts/upload-servers.test.mts: `App::run` under a SAPI, with the application that the
// test built in UPLOAD_APP. The request hook answers every request with what the request gave of its body as JSON:
// whether its input is valid, its form values, and the name, the filename, the content type, the size and the SHA-256
// digest of each file, which it moves into UPLOAD_MOVED, reads and removes; `held` is the number of directories of
// requests in the temporary directory while the request runs.
//
// The variables of a start (the hooks are installed only when UPLOAD_LOG is set, so a start without it runs no hook):
//   UPLOAD_ANSWER  the request hook: unset (the JSON above), app, none (no request hook), mark, accept, alone,
//                  alone-gate, throws, not-a-response, cookies
//   UPLOAD_LOG     the file that receives one line for each call of the request hook, of the shared handler, of a
//                  loader, of the response hook, of the write hook and of the disconnect hook
//   UPLOAD_ERRORS  the file that receives the log of the application (error_log)
//   UPLOAD_HOOK    throws: the response hook throws after its line
//   UPLOAD_LOAD    throws: the loader of the route home throws after its line
//   UPLOAD_SESSIONS_OPEN  throws: the open of the session save handler, which the session of `App::run` starts, throws
//   UPLOAD_BEFORE  1: the header X-Before is set before the application receives the request
//   UPLOAD_HTTPS   1: the application declares https
//   UPLOAD_GATE    the port of the gate of the test; UPLOAD_GATE_AT=shared stops the shared handler at it

use Polyspec\Hyper\App;
use Polyspec\Hyper\MediaType;
use Polyspec\Hyper\Reply;
use Polyspec\Hyper\Representation;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Response;
use Polyspec\Hyper\Result;

$loader = require dirname(__DIR__, 5) . '/vendor/autoload.php';
if (getenv('UPLOAD_ERRORS') !== false) {
    ini_set('error_log', (string) getenv('UPLOAD_ERRORS'));
}

$application = (string) getenv('UPLOAD_APP');
$moved = (string) getenv('UPLOAD_MOVED');
$limit = (int) getenv('UPLOAD_LIMIT');
// The autoloader of Composer maps the namespace of the server program to its directory php, as autoload.psr-4 of an
// application does.
$program = json_decode((string) file_get_contents("{$application}/program/program.json"), true, 4, JSON_THROW_ON_ERROR);
$loader->addPsr4("{$program['namespace']}\\", "{$application}/program/php");
const FILLER_SIZE = 6 * 1024 * 1024;
const JSON_PLAIN = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR;
$log = getenv('UPLOAD_LOG') === false ? null : (string) getenv('UPLOAD_LOG');
$answerMode = getenv('UPLOAD_ANSWER') === false ? '' : (string) getenv('UPLOAD_ANSWER');
// Appends one line to the hook log; without UPLOAD_LOG nothing is written.
$line = static function (string $text) use ($log): void {
    if ($log !== null) {
        file_put_contents($log, "{$text}\n", FILE_APPEND);
    }
};
$elapsed = static fn (float $value): string => is_finite($value) && $value >= 0 ? 'ok' : 'bad';
$failed = static fn (?string $failure): string => json_encode($failure, JSON_PLAIN);
$notes = static function (Reply $reply): string {
    $map = [];
    foreach ($reply->notes() as [$name, $value]) {
        $map[$name] = $value;
    }

    return json_encode((object) $map, JSON_PLAIN);
};
// Stops at the gate of the test until the test opens it or closes the connection of the gate. A read that ends
// without a line because the stream waited too long is no end.
$pass = static function (string $point): void {
    $gate = stream_socket_client('tcp://127.0.0.1:' . getenv('UPLOAD_GATE'), $code, $message);
    if ($gate === false) {
        throw new \RuntimeException("the gate is not reachable: {$message}");
    }
    fwrite($gate, "gate {$point}\n");
    while (fgets($gate) === false && !feof($gate)) {
        continue;
    }
    fclose($gate);
};
// The answer of the first form of this file: what the request gave of its body.
$upload = static function (Request $request) use ($moved): Response {
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
};
// The request hook of UPLOAD_ANSWER. The closure declares no return type, because the mode not-a-response returns a
// string.
$hook = static function (Request $request, \Closure $answer) use ($answerMode, $line, $pass, $upload) {
    $line("around {$request->method} {$request->path()} mark=" . ($request->header('X-Mark') ?? '-'));
    switch ($answerMode) {
        case 'app':
            return $answer($request);
        case 'mark':
            return $answer($request->withHeader('X-Mark', 'changed'))->withHeader('X-Around', 'yes');
        case 'accept':
            return $answer($request->withHeader('Accept', 'application/vnd.hyper+json'));
        case 'alone':
            return Response::text(418, 'alone');
        case 'alone-gate':
            $pass('around');

            return Response::text(200, str_repeat('x', FILLER_SIZE));
        case 'throws':
            throw new \RuntimeException('around boom');
        case 'not-a-response':
            return 'not a response';
        case 'cookies':
            return Response::text(
                200,
                json_encode(['a' => $request->cookie('a'), 'b' => $request->cookie('b')], JSON_PLAIN),
            );
        default:
            return $upload($request);
    }
};
// The line of a handler, which reads the header by its name in lower case (HY-97.4).
$loaded = static function (string $name, Request $request) use ($line): void {
    $line("load {$name} mark=" . ($request->header('x-mark') ?? '-'));
};
$handlers = ['routes' => [
    'home' => ['load' => static function (Request $request) use ($loaded): array {
        $loaded('home', $request);
        if (getenv('UPLOAD_LOAD') === 'throws') {
            throw new \RuntimeException('handler boom');
        }

        return [];
    }],
    // The representation of an item: a PUT answers the JSON value that it read, and a GET the item of the path.
    'item' => [
        'load' => static function (Request $request) use ($loaded): array {
            $loaded('item', $request);

            return [];
        },
        'representations' => [
            'application/vnd.example.item+json' => static fn (Request $request, MediaType $media): Representation
                => new Representation(
                    200,
                    $request->method === 'PUT' ? $request->json() : ['id' => $request->param('id'), 'title' => 'é'],
                ),
        ],
    ],
    'large' => ['load' => static function (Request $request) use ($loaded): array {
        $loaded('large', $request);

        return ['filler' => str_repeat('x', FILLER_SIZE)];
    }],
    'list' => ['regions' => ['rows' => static function (Request $request, Reply $reply): array {
        if ($request->queryInt('embed', 0) === 1) {
            $reply->embedData();
        }

        return ['items' => ['a', 'b'], 'open' => false];
    }]],
    'add' => ['post' => static fn (): Result => Result::redirect('/')],
]];
if ($log !== null) {
    $handlers['shared'] = static function (Request $request, Reply $reply) use ($loaded, $pass): array {
        $loaded('shared', $request);
        $reply->note('stage', 'shared');
        if (getenv('UPLOAD_GATE_AT') === 'shared') {
            $pass('shared');
        }

        return [];
    };
}
$mark = static fn (Request $request): string
    => "{$request->method} {$request->path()} mark=" . ($request->header('X-Mark') ?? '-');
// The hooks of the application and of the server, which a start without UPLOAD_LOG does not install.
$onResponse = static function (
    Request $request,
    Response $response,
    float $time,
    Reply $reply,
    ?string $failure,
) use (
    $line,
    $mark,
    $elapsed,
    $failed,
    $notes,
): void {
    $line(
        "response {$response->status} {$mark($request)} elapsed={$elapsed($time)} failure={$failed($failure)}"
        . " notes={$notes($reply)}",
    );
    if (getenv('UPLOAD_HOOK') === 'throws') {
        throw new \RuntimeException('hook boom');
    }
};
$onDisconnect = static function (
    Request $request,
    float $time,
    Reply $reply,
) use (
    $line,
    $mark,
    $elapsed,
    $notes,
): void {
    $line("disconnect {$mark($request)} elapsed={$elapsed($time)} notes={$notes($reply)}");
};
$written = static function (
    Request $request,
    ?Response $response,
    bool $ended,
    float $time,
    ?string $failure,
) use (
    $line,
    $mark,
    $elapsed,
    $failed,
): void {
    $status = $response === null ? 'null' : $response->status;
    $end = $ended ? 'true' : 'false';
    $line("written {$status} {$end} {$mark($request)} elapsed={$elapsed($time)} failure={$failed($failure)}");
};
// The session store of UPLOAD_SESSIONS_OPEN=throws: PHP starts the session of `App::run` through its save handler,
// whose open fails (HY-60.14).
if (getenv('UPLOAD_SESSIONS_OPEN') === 'throws') {
    session_set_save_handler(new class implements \SessionHandlerInterface {
        public function open(string $path, string $name): bool
        {
            throw new \RuntimeException('the session directory is gone');
        }

        public function close(): bool
        {
            return true;
        }

        public function read(string $id): string|false
        {
            return '';
        }

        public function write(string $id, string $data): bool
        {
            return true;
        }

        public function destroy(string $id): bool
        {
            return true;
        }

        public function gc(int $max_lifetime): int|false
        {
            return 0;
        }
    }, false);
}
if (getenv('UPLOAD_BEFORE') === '1') {
    header('X-Before: kept');
}
App::open(
    manifest: "{$application}/manifest.json",
    program: "{$application}/program",
    handlers: $handlers,
    timezone: 'Z',
    bodyLimit: $limit,
    // UPLOAD_FORMS=urlencoded opens the application without the multipart form type.
    formTypes: getenv('UPLOAD_FORMS') === 'urlencoded'
        ? ['application/x-www-form-urlencoded']
        : ['application/x-www-form-urlencoded', 'multipart/form-data'],
    fileLimit: $limit,
    partLimit: (int) (getenv('UPLOAD_PARTS') ?: 1000),
    https: getenv('UPLOAD_HTTPS') === '1',
    responseLimit: 16 * 1024 * 1024,
    onResponse: $log === null ? null : $onResponse,
    onDisconnect: $log === null ? null : $onDisconnect,
    written: $log === null ? null : $written,
    around: $answerMode === 'none' ? null : $hook,
)->run();
