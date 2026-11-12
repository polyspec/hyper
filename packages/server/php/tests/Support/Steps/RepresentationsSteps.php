<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\App;
use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\Clock;
use Polyspec\Hyper\Tests\Support\ContextRun;
use Polyspec\Hyper\Tests\Support\Json;
use Polyspec\Hyper\Tests\Support\Mailer;
use Polyspec\Hyper\Tests\Support\Plain;
use Polyspec\Hyper\Tests\Support\RepresentationCalls;

/**
 * HY-116 to HY-122: the cases of contracts/representations.json: the manifest and open rejections, and the cases of
 * the representations application, which run through the app with the handlers of the contract.
 */
final class RepresentationsSteps
{
    private const PROGRAM = __DIR__ . '/../../../../../../var/contract-programs/representations';

    /** HY-118: the manifest check rejects a route whose representations do not open. */
    public static function manifestRejections(CaseReader $case): void
    {
        $route = Json::string($case->input('route'));
        $representations = $case->input('representations');
        // The route has a handler for each type that the case declares, so that only the manifest check fails the open.
        $types = self::declaredTypes($case);
        $types[$route] = [];
        foreach (is_array($representations) ? $representations : [] as $entry) {
            if (is_array($entry) && is_string($entry['type'] ?? null)) {
                $types[$route][] = $entry['type'];
            }
        }
        $manifest = RepresentationCalls::manifest(self::PROGRAM . '/manifest.json', [$route => $representations]);
        try {
            $case->outcome('open', self::opens($case, $manifest, $types));
        } finally {
            unlink($manifest);
        }
    }

    /** HY-118: opening the application fails for an entry without a handler and for a handler of another type. */
    public static function openRejections(CaseReader $case): void
    {
        $types = self::declaredTypes($case);
        $types[Json::string($case->input('route'))] = Json::strings($case->input('handlers'));
        $case->outcome('open', self::opens($case, self::PROGRAM . '/manifest.json', $types));
    }

    /** HY-116 to HY-122: the request of a case receives the response of the representations application. */
    public static function cases(CaseReader $case): void
    {
        $calls = new RepresentationCalls();
        $basePath = $case->has('basePath') ? Json::string($case->input('basePath')) : '';
        $app = self::open(
            $case,
            self::PROGRAM . '/manifest.json',
            self::declaredTypes($case),
            $calls->handler($case->has('handler') ? $case->input('handler') : null),
            $basePath,
        );
        // HY-105: each bound service is created by a factory that remembers the object that it returned.
        $created = [];
        foreach ($case->has('bound') ? Json::strings($case->input('bound')) : [] as $name) {
            $class = match ($name) {
                'clock' => Clock::class,
                'mailer' => Mailer::class,
                default => throw new \UnexpectedValueException("the case binds the unknown service {$name}"),
            };
            $app->bind($class, static function () use ($class, $name, &$created): object {
                return $created[$name] = new $class();
            });
        }
        $service = $case->has('handler') ? (Json::array($case->input('handler'))['service'] ?? null) : null;
        $request = Json::array($case->input('request'));
        // An empty map of the contract is an object.
        $headers = Json::stringMap((array) ($request['headers'] ?? []));
        $target = Json::string($request['target'] ?? null);
        $body = $request['body'] ?? '';
        $store = new ArraySession();
        $response = $app->handle(
            new Request(
                Json::string($request['method'] ?? null),
                Request::targetPath($target),
                $headers,
                Request::targetQuery($target),
                is_string($body) ? $body : '',
            ),
            $store,
        );
        $type = $response->headers['Content-Type'] ?? null;
        $received = $calls->headers(array_map(strval(...), array_keys($headers)));
        $case->compare('status', $response->status);
        $case->compare('headers', $response->headers);
        $case->compare('body', $response->body);
        $case->compare('absentHeaders', $response->headers);
        $case->compare('page', is_string($type) ? trim(explode(';', $type, 2)[0]) : null);
        $case->compare('handled', $calls->handled);
        $case->compare('session', $store->get('_hyper_csrf') !== null);
        $case->compare('received.method', $calls->request?->method);
        $case->compare('received.parameters', Plain::map($calls->parameters));
        $case->compare('received.body', $calls->request?->json());
        $case->compare('received.headers', $received);
        $case->compare('received.absentHeaders', $received);
        $case->compare(
            'received.service',
            $calls->service !== null && is_string($service) && $calls->service === ($created[$service] ?? null),
        );
        $case->compare('received.params', $calls->request === null ? null : Plain::map($calls->request->params()));
    }

    /**
     * Returns the representation types that each route of the manifest of the application declares, by the route name.
     *
     * @return array<string, list<string>>
     */
    private static function declaredTypes(CaseReader $case): array
    {
        $types = [];
        foreach (Json::arrays(Json::at(self::application($case), 'manifest', 'routes')) as $route) {
            $types[Json::string($route['name'] ?? null)] = array_map(
                static fn (array $entry): string => Json::string($entry['type'] ?? null),
                Json::arrays($route['representations'] ?? []),
            );
        }

        return $types;
    }

    /** @return array<array-key, mixed> */
    private static function application(CaseReader $case): array
    {
        return Json::array(Json::at($case->input('applications'), 'representations'));
    }

    /**
     * Opens the representations application with a manifest: each route loads the data of the contract and has the
     * handler for each of the given types.
     *
     * @param array<string, list<string>> $types
     */
    private static function open(
        CaseReader $case,
        string $manifest,
        array $types,
        \Closure $handler,
        string $basePath,
    ): App {
        ContextRun::autoload(self::PROGRAM);
        $loaders = Json::array(Json::at(self::application($case), 'loaders'));
        $routes = [];
        foreach ($types as $name => $declared) {
            // An empty map of the contract is an object; a loader returns an array.
            $data = (array) ($loaders[$name] ?? []);
            $routes[$name] = [
                'load' => static fn (): array => $data,
                'representations' => array_fill_keys($declared, $handler),
            ];
        }

        return App::open($manifest, self::PROGRAM . '/program', ['routes' => $routes], '+09:00', basePath: $basePath);
    }

    /**
     * Returns the error of an open with handlers that no request reaches, or null when the open did not fail.
     *
     * @param array<string, list<string>> $types
     */
    private static function opens(CaseReader $case, string $manifest, array $types): ?\Throwable
    {
        $rejected = static fn (): never => throw new \LogicException(
            'a representation handler of a rejection case is called',
        );
        try {
            self::open($case, $manifest, $types, $rejected, '');
        } catch (\Throwable $error) {
            return $error;
        }

        return null;
    }
}
