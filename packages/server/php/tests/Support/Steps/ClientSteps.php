<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\Choice;
use Polyspec\Hyper\ClientRendering;
use Polyspec\Hyper\Csrf;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Response;
use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\ClientApp;
use Polyspec\Hyper\Tests\Support\Counter;
use Polyspec\Hyper\Tests\Support\CountingStore;
use Polyspec\Hyper\Tests\Support\Json;
use Polyspec\Hyper\Tests\Support\Plain;
use Polyspec\Hyper\Tests\Support\Reports;
use Polyspec\Hyper\Tests\Support\RepresentationCalls;
use Polyspec\Hyper\Tests\Support\ServerLog;
use Polyspec\Hyper\Tests\Support\Untyped;

/** HY-62: the cases of contracts/client.json. */
final class ClientSteps
{
    // A session token of HY-24; the form carries a masked value of it.
    private const TOKEN = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

    public static function cases(CaseReader $case): void
    {
        $basePath = Json::string($case->input('basePath'));
        $chosenHost = Json::string($case->input('chosenHost'));
        if ($case->input('shell') !== file_get_contents(ClientApp::SHELL)) {
            throw new \LogicException('the shell fixture differs from the shell file');
        }
        // The entries of the routes of the case, each with the response of its handler, which `handler` replaces.
        $declared = [];
        $handlers = [];
        $calls = new RepresentationCalls();
        foreach (Json::array($case->input('representations')) as $route => $entries) {
            foreach (Json::arrays($entries) as $entry) {
                $response = $case->has('handler') ? $case->input('handler') : ($entry['handler'] ?? null);
                $handlers[(string) $route][Json::string($entry['type'] ?? null)] = $calls->handler($response);
                unset($entry['handler']);
                $declared[(string) $route][] = $entry;
            }
        }

        $selections = 0;
        $selects = self::selection($case->has('selects') ? Json::string($case->input('selects')) : 'host', $chosenHost);
        $client = new ClientRendering(
            ClientApp::SHELL,
            $basePath,
            static function (Request $request) use ($selects, &$selections): mixed {
                $selections++;

                return $selects($request);
            },
        );
        // HY-60: the response hook records each call.
        $reports = new Reports();
        $options = ['onResponse' => $reports->hook()];
        $stated = $case->has('options') ? (array) $case->input('options') : [];
        foreach ($stated as $name => $value) {
            $known = match ($name) {
                'bodyLimit' => is_int($value),
                'frameAncestors' => is_string($value),
                default => false,
            };
            if (!$known) {
                throw new \UnexpectedValueException("{$name} is no option of a case or has a value of another type");
            }
        }
        if (is_int($stated['bodyLimit'] ?? null)) {
            $options['bodyLimit'] = $stated['bodyLimit'];
        }
        if (is_string($stated['frameAncestors'] ?? null)) {
            $options['frameAncestors'] = $stated['frameAncestors'];
        }
        $observed = [];
        $observe = null;
        if ($case->has('observed')) {
            $observe = static function (string $name, mixed $value) use (&$observed): void {
                $observed[] = [$name, $value];
            };
        }

        $counter = new Counter();
        $store = new CountingStore();
        $request = Json::array($case->input('request'));
        $form = array_key_exists('form', $request) ? Json::stringMap((array) $request['form']) : null;
        if ($request['csrf'] ?? false) {
            $store->preset('_hyper_csrf', self::TOKEN);
            $form = ['_csrf' => Csrf::masked(self::TOKEN), ...$form ?? []];
        }
        $headers = Json::stringMap((array) ($request['headers'] ?? []));
        if ($form !== null) {
            $headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }
        // The body of the case replaces the body of the form.
        $body = array_key_exists('body', $request)
            ? Json::string($request['body'])
            : ($form === null ? '' : http_build_query($form));
        $target = Json::string($request['target'] ?? null);
        $manifest = RepresentationCalls::manifest(ClientApp::MANIFEST, $declared);
        try {
            $options['manifest'] = $manifest;
            $app = ClientApp::open($client, $counter, $options, $handlers, $observe);
        } finally {
            unlink($manifest);
        }
        $given = new Request(
            Json::string($request['method'] ?? null),
            Request::targetPath($target),
            $headers,
            Request::targetQuery($target),
            $body,
        );
        $selections = 0;
        [$response, $log] = ServerLog::during(static fn (): Response => $app->handle($given, $store));

        $case->compare('storeCalls', $store->log);
        $case->compare('firstStoreCalls', $store->log);
        $case->compare('selections', $selections);
        $case->compare('observed', $observed);
        $case->compare('logged', $log);
        $case->compare('logCount', ServerLog::count($log));

        $case->compare('reported', $reports->reported());
        if ($case->has('reportedHeaders') || $case->has('notes')) {
            $last = $reports->last();
            $case->compare('reportedHeaders', $last[1]->headers);
            $case->compare('notes', $last[3]->notes());
        }

        $case->compare('status', $response->status);
        $case->compare('headers', $response->headers);
        $case->compare('allHeaders', $response->headers);
        $case->compare('absentHeaders', $response->headers);
        $case->compare('body', $response->body);
        $case->compare('bodyContains', $response->body);
        $case->compare('bodyNotContains', $response->body);
        if ($case->has('json')) {
            // The maps of the response stay objects, so an empty map of the contract is an empty object.
            $json = Json::object(json_decode($response->body) ?? new \stdClass());
            $case->compare('json.route', $json->route ?? null);
            $case->compare('json.params', $json->params ?? null);
            $case->compare('json.regions', $json->regions ?? null);
        }
        // HY-62: the session holds no token after a request whose expected session is false.
        $case->compare('session', $store->holds('_hyper_csrf'));
        $case->compare('actions', $counter->actions);
        $case->compare('handled', $calls->handled);
        // `received` is optional: a case without it compares none of its fields.
        if (!$case->has('received')) {
            return;
        }
        $case->compare('received.parameters', Plain::map($calls->parameters));
        $case->compare('received.selection', $calls->request?->selection());
        $case->compare('received.absentHeaders', $calls->headers(array_map(strval(...), array_keys($headers))));
    }

    /** HY-62.15, HY-62.35: opening the application fails for a client rendering that cannot be used. */
    public static function openRejections(CaseReader $case): void
    {
        $basePath = Json::string($case->input('basePath'));
        $shell = Json::string($case->input('shell'));
        $declares = static fn (string $base): string => '<meta name="hyper-api" content="' . $base . '">';
        if (substr_count($shell, $declares($basePath)) !== 1) {
            throw new \LogicException('the shell fixture does not declare the data base path of the fixture once');
        }
        $dataBasePath = $case->has('dataBasePath') ? Json::string($case->input('dataBasePath')) : $basePath;
        $directory = sys_get_temp_dir() . '/hyper-shell-' . bin2hex(random_bytes(6));
        mkdir($directory);
        $file = "{$directory}/index.html";
        $kind = Json::string($case->input('shellFile'));
        $failure = null;
        try {
            $path = match ($kind) {
                'declared' => self::written($file, str_replace($declares($basePath), $declares($dataBasePath), $shell)),
                'other-base' => self::written($file, str_replace($declares($basePath), $declares('/api'), $shell)),
                'relative' => 'tests/fixtures/shell/index.html',
                'missing' => "{$directory}/missing.html",
                'directory' => $directory,
                'not-utf8' => self::written($file, "{$shell}\xFF\xFE"),
                'unreadable' => self::unreadable(self::written($file, $shell)),
                default => throw new \UnexpectedValueException("the shell file {$kind} of the case is unknown"),
            };
            try {
                ClientApp::open(
                    new ClientRendering($path, $dataBasePath, static fn (): Choice => new Choice(true, null)),
                    new Counter(),
                );
            } catch (\Throwable $error) {
                $failure = $error;
            }
        } finally {
            if (is_file($file)) {
                chmod($file, 0o600);
                unlink($file);
            }
            rmdir($directory);
        }
        $case->outcome('open', $failure);
        $case->compare('openError', $failure?->getMessage() ?? '');
    }

    /** HY-62: a choice and a client rendering hold what they were made with; no application opens. */
    public static function declaration(CaseReader $case): void
    {
        $chosen = $case->input('chosen');
        if (!is_bool($chosen)) {
            throw new \UnexpectedValueException('the case field chosen is not a boolean');
        }
        $choice = new Choice($chosen, $case->input('value'));
        $rendering = new ClientRendering(
            Json::string($case->input('shellPath')),
            Json::string($case->input('dataBasePath')),
            static fn (Request $request): Choice => $choice,
        );
        $selected = ($rendering->selects)(new Request('GET', '/'));
        if (!$selected instanceof Choice) {
            throw new \UnexpectedValueException('the selection of the case returned no choice');
        }
        $case->compare('choice', ['chosen' => $choice->chosen, 'value' => $choice->value]);
        $case->compare('rendering', [
            'shell' => $rendering->shell,
            'basePath' => $rendering->basePath,
            'selected' => ['chosen' => $selected->chosen, 'value' => $selected->value],
        ]);
    }

    private static function written(string $file, string $bytes): string
    {
        file_put_contents($file, $bytes);

        return $file;
    }

    /** Sets the mode of a file to 0, and fails when the process still reads it, as a privileged user does. */
    private static function unreadable(string $file): string
    {
        chmod($file, 0);
        clearstatcache(true, $file);
        if (is_readable($file)) {
            throw new \LogicException('the process reads a file of mode 0, so the case checks nothing');
        }

        return $file;
    }

    /**
     * Returns the selection of a name of `selects`: the choice of a request, or what a selection that fails returns
     * or throws (HY-62.11).
     *
     * @return \Closure(Request): mixed
     */
    private static function selection(string $name, string $chosenHost): \Closure
    {
        return match ($name) {
            'host' => static fn (Request $request): Choice => new Choice(
                $request->header('Host') === $chosenHost,
                null,
            ),
            'hostValue' => static fn (Request $request): Choice => new Choice(
                $request->header('Host') === $chosenHost,
                ['host' => $request->header('Host') ?? ''],
            ),
            'text' => static fn (): string => 'csr',
            'boolean' => static fn (): bool => true,
            // HY-62.11: a record with the members of a choice is not a Choice.
            'record' => static fn (): array => ['chosen' => true, 'value' => null],
            'throws' => static fn (): never => throw new \RuntimeException('selection'),
            // The constructor refuses a `chosen` that is no boolean under strict types, so the selection throws; the
            // class is named without its type, because the type of the constructor excludes the value of the case.
            'chosenNotBoolean' => static fn (): object => new (Untyped::name(Choice::class))('yes', null),
            default => throw new \UnexpectedValueException("the selection {$name} of the case is unknown"),
        };
    }
}
