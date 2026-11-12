<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\App;
use Polyspec\Hyper\Csrf;
use Polyspec\Hyper\Renderer;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Response;
use Polyspec\Hyper\Session;
use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\AppRun;
use Polyspec\Hyper\Tests\Support\Bytes;
use Polyspec\Hyper\Tests\Support\CountingStore;
use Polyspec\Hyper\Tests\Support\Json;
use Polyspec\Hyper\Tests\Support\Plain;
use Polyspec\Hyper\Tests\Support\ServerLog;

/**
 * The cases of contracts/app.json: one request to a page application whose handlers are lists of steps, after the
 * requests of `before` in the same session, and the opens that fail.
 */
final class AppSteps
{
    private const PROGRAMS = __DIR__ . '/../../../../../var/contract-programs';
    private const TOKEN = '_hyper_csrf';
    private const KEYS = [self::TOKEN, '_hyper_flash', '_hyper_keep'];
    /** The files of an application that a case of `opens` replaces or removes, by the name of the case. */
    private const FILES = [
        'manifest' => 'manifest.json',
        'reads.json' => 'program/reads.json',
        'build.json' => 'program/build.json',
        'program.json' => 'program/program.json',
        'templates' => 'program/templates',
        'php' => 'program/php',
    ];

    public static function cases(CaseReader $case): void
    {
        $case->input('valueKinds');
        [$run, $directory, $store] = self::run($case);
        $app = $run->open("{$directory}/manifest.json", "{$directory}/program");
        $keys = self::KEYS;
        if ($case->has('stored')) {
            foreach (Json::map($case->input('stored'), 'the stored values') as $key => $value) {
                $store->preset((string) $key, self::hostValue($value));
                $keys[] = (string) $key;
            }
        }
        // The responses of the requests of `before` by their names, each with the token that the session held after it.
        $earlier = [];
        foreach ($case->has('before') ? Json::list($case->input('before')) : [] as $index => $item) {
            $item = Json::map($item, 'a request of before');
            $name = array_key_exists('name', $item) ? Json::string($item['name']) : (string) $index;
            $held = null;
            $response = self::send($app, $store, $item, $earlier, $held)[0];
            if (array_key_exists('status', $item) && $item['status'] !== $response->status) {
                throw new \UnexpectedValueException("the request {$name} of before answered {$response->status}");
            }
            if (array_key_exists($name, $earlier)) {
                throw new \UnexpectedValueException("the name {$name} of before is not unique");
            }
            $earlier[$name] = [$response, $store->peek(self::TOKEN)];
        }

        $run->reset();
        $handler = self::errorHandler();
        $tokenBefore = null;
        [[$response, $least, $most], $log] = ServerLog::during(
            static function () use ($app, $store, $case, $earlier, &$tokenBefore): array {
                $request = Json::map($case->input('request'), 'the request');

                return self::send($app, $store, $request, $earlier, $tokenBefore);
            },
        );
        $calls = $store->log;
        $body = $response->body;
        $token = $store->peek(self::TOKEN);
        $unmasked = self::unmasked($body, $token);

        $case->compare('status', $response->status);
        $case->compare('headers', $response->headers);
        $case->compare('allHeaders', $response->headers);
        $case->compare('absentHeaders', $response->headers);
        $case->compare('body', $body);
        $case->compare('bodyContains', $body);
        $case->compare('bodyNotContains', $body);
        $case->compare('unmaskedBody', $unmasked);
        if ($case->has('members')) {
            $case->compare('members', Json::object(json_decode($unmasked, false, 512, JSON_THROW_ON_ERROR)));
        }
        if ($case->has('embedded')) {
            $open = '<script type="application/json" id="hy-data">';
            $from = strpos($unmasked, $open);
            $to = $from === false ? false : strpos($unmasked, '</script>', $from);
            if ($from === false || $to === false) {
                throw new \UnexpectedValueException('the document holds no element hy-data');
            }
            $text = substr($unmasked, $from + strlen($open), $to - $from - strlen($open));
            $case->compare('embedded', Json::object(json_decode($text, false, 512, JSON_THROW_ON_ERROR)));
        }
        if ($case->has('bodyCount')) {
            $case->compare('bodyCount', array_map(
                static fn (string $text): int => substr_count($body, $text),
                Json::strings($case->input('counted')),
            ));
        }
        if ($case->has('keys') || $case->has('sharedKeys') || $case->has('regionKeys')) {
            $json = Json::array(json_decode($body, true, 512, JSON_THROW_ON_ERROR));
            $case->compare('keys', $json);
            if ($case->has('sharedKeys')) {
                $case->compare('sharedKeys', Json::array($json['shared'] ?? null));
            }
            if ($case->has('regionKeys')) {
                $case->compare('regionKeys', Json::array($json['regions'] ?? null));
            }
        }
        $case->compare('tagOfBody', ($response->headers['ETag'] ?? null) === self::tag($body, $token));
        if ($case->has('sameAsEarlier')) {
            $name = Json::string($case->input('earlier'));
            [$first, $firstToken] = $earlier[$name]
                ?? throw new \UnexpectedValueException("before has no request {$name}");
            $tag = $response->headers['ETag'] ?? null;
            $mask = self::maskOf($body);
            $case->compare('sameAsEarlier', [
                'tag' => $tag !== null && $tag === ($first->headers['ETag'] ?? null),
                'mask' => $mask !== null && $mask === self::maskOf($first->body),
                'body' => $unmasked === self::unmasked($first->body, $firstToken),
            ]);
        }

        $case->compare('firstCalls', $run->calls);
        $case->compare('handlerCalls', $run->calls);
        $case->compare('actions', count(array_filter(
            $run->calls,
            static fn (string $call): bool => str_starts_with($call, 'action:'),
        )));
        // A masked value of the token that the session holds after the request is written `masked`.
        $case->compare('observed', array_map(
            static fn (array $pair): array => [
                $pair[0],
                is_string($pair[1]) && is_string($token) && Csrf::verify($token, $pair[1]) ? 'masked' : $pair[1],
            ],
            $run->observed,
        ));
        if ($case->has('browsers')) {
            $case->compare('browsers', array_map(
                static fn (array $pair): string => self::browserWord($pair[1], $token, $tokenBefore),
                $run->observed,
            ));
        }
        $case->compare('serviceValues', Plain::map($run->serviceValues()));
        $case->compare('valueReads', $run->reads);

        $case->compare('reported', $run->reports->reported());
        $hook = ['reportedHeaders', 'notes', 'failure', 'failureReported', 'failureLogged', 'elapsedFromStart'];
        if (array_filter($hook, $case->has(...)) !== []) {
            $last = $run->reports->last();
            $case->compare('reportedHeaders', $last[1]->headers);
            $case->compare('notes', $last[3]->notes());
            $case->compare('failure', $last[4]);
            $case->compare('failureReported', $last[4] !== null);
            $case->compare('failureLogged', is_string($last[4]) && ServerLog::holds($log, 'hyper: ' . $last[4]));
            $case->compare('elapsedFromStart', $last[2] >= $least && $last[2] <= $most);
        }

        if ($case->has('storedAfter')) {
            $after = [];
            foreach (array_unique([...$keys, ...array_keys((array) $case->input('storedAfter'))]) as $key) {
                $after[(string) $key] = $store->peek((string) $key);
            }
            $case->compare('storedAfter', $after);
        }
        $case->compare('renewals', count(array_keys($calls, 'renew', true)));
        if ($case->has('tokenOfSession')) {
            $mask = self::maskOf($body);
            if ($mask === null || !is_string($token)) {
                throw new \UnexpectedValueException('the body holds no masked token or the session holds no token');
            }
            $case->compare('tokenOfSession', Csrf::verify($token, $mask));
        }
        $case->compare('tokenRenewed', $token !== $tokenBefore);
        $case->compare('tokenForm', is_string($token) && preg_match('/^[0-9a-f]{64}$/D', $token) === 1);
        $case->compare('tokenInBody', is_string($token) && str_contains($body, $token));
        $case->compare('session', $token !== null);
        $case->compare('storeCalls', $calls);
        $case->compare('logged', $log);
        $case->compare('logCount', ServerLog::count($log));
        if ($case->has('restored')) {
            $case->compare('restored', self::errorHandler() === $handler && self::warningIsDelivered());
        }
    }

    /** Opens the application of a case with its handlers, its options and its files, and records the error. */
    public static function opens(CaseReader $case): void
    {
        [$run, $directory] = self::run($case);
        $copy = null;
        $failure = null;
        try {
            if ($case->has('files')) {
                $copy = sys_get_temp_dir() . '/hyper-app-' . bin2hex(random_bytes(6));
                mkdir($copy);
                copy("{$directory}/manifest.json", "{$copy}/manifest.json");
                self::copy("{$directory}/program", "{$copy}/program");
                foreach (Json::map($case->input('files'), 'the files') as $name => $text) {
                    $path = "{$copy}/" . (self::FILES[$name] ?? throw new \UnexpectedValueException(
                        "{$name} is no file of an application of this runtime",
                    ));
                    self::remove($path);
                    if ($text !== null) {
                        file_put_contents($path, Bytes::of(Json::string($text)));
                    }
                }
                $directory = $copy;
            }
            try {
                $run->open("{$directory}/manifest.json", "{$directory}/program");
            } catch (\Throwable $error) {
                $failure = $error;
            }
        } finally {
            if ($copy !== null) {
                self::remove($copy);
            }
        }
        $case->outcome('open', $failure);
        $case->compare('openError', $failure?->getMessage() ?? '');
    }

    /**
     * HY-12, HY-13: renders the title and each region of a route alone and the document, and records the document and
     * the page region with each part replaced by its place.
     */
    public static function parts(CaseReader $case): void
    {
        $name = Json::string($case->input('application'));
        $application = Json::map(Json::array($case->input('applications'))[$name] ?? null, "the application {$name}");
        $directory = self::PROGRAMS . "/{$name}";
        $manifest = Json::map($application['manifest'] ?? null, 'the manifest');
        $wanted = Json::string($case->input('route'));
        $route = null;
        foreach (Json::arrays($manifest['routes'] ?? null) as $declared) {
            $route = ($declared['name'] ?? null) === $wanted ? $declared : $route;
        }
        if ($route === null) {
            throw new \UnexpectedValueException("the manifest has no route {$wanted}");
        }
        $renderer = Renderer::open("{$directory}/program", Json::string($application['timezone'] ?? '+09:00'));
        $shared = $renderer->bind(Json::map($case->input('shared'), 'the shared data'));
        $bound = [];
        foreach (Json::map($case->input('regions'), 'the regions') as $region => $data) {
            $bound[(string) $region] = $renderer->bind(Json::map($data, "the data of the region {$region}"));
        }
        $routeRegions = [];
        foreach (Json::arrays($route['regions'] ?? []) as $region) {
            $regionName = Json::string($region['name'] ?? null);
            if (array_key_exists($regionName, $bound)) {
                $routeRegions[$regionName] = [
                    'template' => Json::string($region['template'] ?? null),
                    'data' => $bound[$regionName],
                ];
            }
        }
        $title = $renderer->alone(Json::string($manifest['title'] ?? null), $shared, $renderer->bind([]));
        $manifestRegions = [];
        $page = '';
        $parts = [];
        foreach (Json::arrays($manifest['regions'] ?? null) as $region) {
            $regionName = Json::string($region['name'] ?? null);
            $isPage = ($region['page'] ?? false) === true;
            $page = $isPage ? $regionName : $page;
            $manifestRegions[$regionName] = [
                'template' => Json::string($isPage ? ($route['template'] ?? null) : ($region['template'] ?? null)),
                'data' => $bound[$regionName]
                    ?? throw new \UnexpectedValueException("the case has no data of {$regionName}"),
            ];
            $parts[$regionName] = $renderer->alone(
                $manifestRegions[$regionName]['template'],
                $shared,
                $manifestRegions[$regionName]['data'],
                $isPage ? $routeRegions : [],
            );
        }
        $pageFrame = $parts[$page] ?? throw new \UnexpectedValueException('the manifest has no page region');
        $frame = self::placed(
            $renderer->document(
                Json::string($manifest['layout'] ?? null),
                Json::string($manifest['title'] ?? null),
                $shared,
                $manifestRegions,
                $page,
                $routeRegions,
                null,
                Json::string($application['build'] ?? null),
            ),
            $title,
            'title',
        );
        foreach (array_keys($manifestRegions) as $regionName) {
            $frame = self::placed($frame, $parts[$regionName], $regionName);
        }
        foreach ($routeRegions as $regionName => $region) {
            $parts[$regionName] = $renderer->alone($region['template'], $shared, $region['data']);
            $pageFrame = self::placed($pageFrame, $parts[$regionName], $regionName);
        }
        $case->compare('title', $title);
        $case->compare('parts', $parts);
        $case->compare('frame', $frame);
        $case->compare('pageFrame', $pageFrame);
    }

    /** Returns the text with the first occurrence of a part replaced by its place, and fails for a part without one. */
    private static function placed(string $text, string $part, string $name): string
    {
        $at = $part === '' ? false : strpos($text, $part);
        if ($at === false) {
            throw new \UnexpectedValueException("the part {$name} is empty or does not occur where it is placed");
        }

        return substr_replace($text, "{# {$name}}", $at, strlen($part));
    }

    /**
     * Returns the run of the application of a case and the directory of its built program, with a new
     * recording store.
     *
     * @return array{0: AppRun, 1: string, 2: CountingStore}
     */
    private static function run(CaseReader $case): array
    {
        $name = Json::string($case->input('application'));
        $applications = Json::array($case->input('applications'));
        $directory = self::PROGRAMS . "/{$name}";

        return [
            new AppRun(
                Json::map($applications[$name] ?? null, "the application {$name}"),
                $case->has('handlers') ? Json::map($case->input('handlers'), 'the handlers') : [],
                $case->has('options') ? Json::map($case->input('options'), 'the options') : [],
            ),
            $directory,
            new CountingStore(),
        ];
    }

    /**
     * Sends a request of the request form: the texts are bytes, the references are resolved now, and nothing is added.
     * Returns the response and the least and the most elapsed milliseconds that the response hook may receive: from the
     * start that `handle` counts from to the clock just before and just after `handle`. The calls of the store before
     * the request are forgotten, and `$tokenBefore` receives the token that the session holds when the request is sent.
     *
     * @param array<array-key, mixed> $request
     * @param array<string, array{0: Response, 1: mixed}> $earlier
     * @return array{0: Response, 1: float, 2: float}
     */
    private static function send(
        App $app,
        CountingStore $store,
        array $request,
        array $earlier,
        mixed &$tokenBefore,
    ): array {
        $unknown = array_diff(array_keys($request), [
            'name',
            'status',
            'method',
            'target',
            'headers',
            'cookies',
            'form',
            'csrf',
            'body',
            'https',
            'startedBefore',
        ]);
        if ($unknown !== []) {
            throw new \UnexpectedValueException('a request holds the unknown member ' . implode(', ', $unknown));
        }
        $text = static fn (mixed $value): string => self::text($value, $store, $earlier);
        $texts = static function (string $member) use ($request, $text): array {
            $map = [];
            foreach (Json::map($request[$member] ?? [], "the member {$member} of a request") as $name => $value) {
                $map[Bytes::of((string) $name)] = $text($value);
            }

            return $map;
        };
        $target = $text($request['target'] ?? null);
        $body = array_key_exists('body', $request) ? $text($request['body']) : '';
        $csrf = $request['csrf'] ?? false;
        if (array_key_exists('form', $request)) {
            if (array_key_exists('body', $request)) {
                throw new \UnexpectedValueException('a request states a form and a body');
            }
            $pairs = [];
            foreach ($texts('form') as $name => $value) {
                $pairs[] = rawurlencode((string) $name) . '=' . rawurlencode($value);
            }
            if ($csrf !== false) {
                $token = (new Session($store))->csrfToken();
                $pairs[] = '_csrf=' . match ($csrf) {
                    true => Csrf::masked($token),
                    'token' => $token,
                    default => throw new \UnexpectedValueException('the member csrf of a request is unknown'),
                };
            }
            $body = implode('&', $pairs);
        } elseif ($csrf !== false) {
            throw new \UnexpectedValueException('the member csrf of a request needs a form');
        }
        $before = $request['startedBefore'] ?? null;
        if ($before !== null && !is_int($before)) {
            throw new \UnexpectedValueException('the member startedBefore of a request is no integer');
        }
        $given = new Request(
            Json::string($request['method'] ?? null),
            Request::targetPath($target),
            $texts('headers'),
            Request::targetQuery($target),
            $body,
            cookies: $texts('cookies'),
            https: ($request['https'] ?? false) === true,
        );
        $store->log = [];
        $tokenBefore = $store->peek(self::TOKEN);

        // PHPUnit lowers error_reporting() while a test runs; a host reports every level, which the server reads
        // (HY-74.5).
        $reporting = error_reporting(E_ALL);
        try {
            $t0 = hrtime(true);
            $start = $before === null ? $t0 : $t0 - $before * 1000000;
            $response = $before === null ? $app->handle($given, $store) : $app->handle($given, $store, $start);
            $t1 = hrtime(true);

            return [$response, ($t0 - $start) / 1e6, ($t1 - $start) / 1e6];
        } finally {
            error_reporting($reporting);
        }
    }

    /**
     * Returns the bytes of a text of a request: a string, a reference or a list of them.
     *
     * @param array<string, array{0: Response, 1: mixed}> $earlier
     */
    private static function text(mixed $value, CountingStore $store, array $earlier): string
    {
        if (is_string($value)) {
            return Bytes::of($value);
        }
        $value = Json::array($value);
        if (array_is_list($value)) {
            return implode('', array_map(
                static fn (mixed $part): string => self::text($part, $store, $earlier),
                $value,
            ));
        }
        if (array_key_exists('repeat', $value)) {
            return str_repeat(
                Bytes::of(Json::string($value['repeat'])),
                Json::integer($value['times'] ?? null, 'the count of a repeat'),
            );
        }
        if (array_key_exists('token', $value)) {
            $token = (new Session($store))->csrfToken();

            return match ($value['token']) {
                'masked' => Csrf::masked($token),
                'session' => $token,
                default => throw new \UnexpectedValueException('a token reference is unknown'),
            };
        }
        $name = Json::string($value['of'] ?? null);
        $response = ($earlier[$name] ?? throw new \UnexpectedValueException("before has no request {$name}"))[0];
        if (array_key_exists('header', $value)) {
            $wanted = Json::string($value['header']);
            foreach ($response->headers as $header => $text) {
                if (strcasecmp((string) $header, $wanted) === 0 && is_string($text)) {
                    return $text;
                }
            }

            throw new \UnexpectedValueException("the response to {$name} has no header {$wanted}");
        }
        if (array_key_exists('json', $value)) {
            $found = json_decode($response->body, true, 512, JSON_THROW_ON_ERROR);
            foreach (Json::list($value['json']) as $key) {
                $found = is_array($found) && (is_string($key) || is_int($key)) ? ($found[$key] ?? null) : null;
            }

            return Json::string($found);
        }
        $cookie = Json::string($value['setCookie'] ?? null);
        foreach ((array) ($response->headers['Set-Cookie'] ?? []) as $line) {
            if (str_starts_with($line, "{$cookie}=")) {
                return substr($line, strlen($cookie) + 1, strcspn($line, ';') - strlen($cookie) - 1);
            }
        }

        throw new \UnexpectedValueException("the response to {$name} sets no cookie {$cookie}");
    }

    /**
     * Returns the word of a value that a handler read as `browser()`: `none` for null, `current` for the digest of
     * the token that the session holds after the request, `previous` for the digest of another token that it held
     * when the request was sent, and `other` for every other value.
     */
    private static function browserWord(mixed $value, mixed $after, mixed $before): string
    {
        $digest = static fn (mixed $token): ?string => (
            is_string($token) && preg_match('/^[0-9a-f]{64}$/D', $token) === 1
                ? hash('sha256', (string) hex2bin($token))
                : null
        );
        if ($value === null) {
            return 'none';
        }
        if ($digest($after) !== null && $value === $digest($after)) {
            return 'current';
        }
        if ($digest($before) !== null && $before !== $after && $value === $digest($before)) {
            return 'previous';
        }

        return 'other';
    }

    /** Returns the body with every masked value of the token replaced by the text `masked` (HY-24). */
    private static function unmasked(string $body, mixed $token): string
    {
        return (string) preg_replace_callback(
            '/(?<![0-9a-f])[0-9a-f]{128}(?![0-9a-f])/',
            static fn (array $found): string => is_string($token) && Csrf::verify($token, $found[0])
                ? 'masked'
                : $found[0],
            $body,
        );
    }

    /** Returns the string `shared.csrf` of a JSON body, or null. */
    private static function maskOf(string $body): ?string
    {
        $json = json_decode($body, true);
        $mask = is_array($json) && is_array($json['shared'] ?? null) ? ($json['shared']['csrf'] ?? null) : null;

        return is_string($mask) ? $mask : null;
    }

    /** Returns the tag of a body: of its bytes with the masked token replaced by the token of the session (HY-53). */
    private static function tag(string $body, mixed $token): string
    {
        $mask = self::maskOf($body);
        $text = $mask !== null && is_string($token) ? str_replace($mask, $token, $body) : $body;

        return 'W/"' . substr(hash('sha256', $text), 0, 32) . '"';
    }

    /** Returns a stored value of a case as the host value: a map is an array, an empty map the empty array. */
    private static function hostValue(mixed $value): mixed
    {
        if ($value instanceof \stdClass) {
            return [];
        }

        return is_array($value) ? array_map(self::hostValue(...), $value) : $value;
    }

    /** Returns the error handler that is set now. */
    private static function errorHandler(): mixed
    {
        $handler = set_error_handler(null);
        restore_error_handler();

        return $handler;
    }

    /** Raises the warning `outside` under a handler of the step, and returns whether the handler received it. */
    private static function warningIsDelivered(): bool
    {
        $delivered = false;
        set_error_handler(static function (int $level, string $message) use (&$delivered): bool {
            $delivered = $level === E_USER_WARNING && $message === 'outside';

            return true;
        });
        try {
            trigger_error('outside', E_USER_WARNING);
        } finally {
            restore_error_handler();
        }

        return $delivered;
    }

    private static function copy(string $from, string $to): void
    {
        mkdir($to);
        foreach (array_diff((array) scandir($from), ['.', '..']) as $name) {
            is_dir("{$from}/{$name}")
                ? self::copy("{$from}/{$name}", "{$to}/{$name}")
                : copy("{$from}/{$name}", "{$to}/{$name}");
        }
    }

    private static function remove(string $path): void
    {
        if (is_dir($path)) {
            foreach (array_diff((array) scandir($path), ['.', '..']) as $name) {
                self::remove("{$path}/{$name}");
            }
            rmdir($path);
        } elseif (is_file($path)) {
            unlink($path);
        }
    }
}
