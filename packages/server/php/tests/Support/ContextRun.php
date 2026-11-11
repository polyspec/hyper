<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

use Polyspec\Hyper\App;
use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\Csrf;
use Polyspec\Hyper\NotFound;
use Polyspec\Hyper\Reply;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Response;
use Polyspec\Hyper\Result;

/**
 * Opens one application of contracts/context.json with its declared handlers and records the calls of the handlers
 * (HY-124). The program of each application is built by scripts/contract-programs.mjs into var/contract-programs.
 *
 * @phpstan-type Application array{manifest: array<string, mixed>, shared: array<string, mixed>, context?: string,
 *     loaders: array<string, array<string, mixed>>, embedData: list<string>,
 *     actions: array<string, array<string, mixed>>}
 */
final class ContextRun
{
    /** @var array<string, true> the namespaces whose programs the autoloader maps */
    private static array $mapped = [];

    /** @var list<string> the calls of the handlers in order: `action:<route>`, `context` and `shared` */
    public array $calls = [];

    /** @var list<mixed> the selection values that the context handler received */
    public array $selections = [];

    /** @param Application $application */
    public function __construct(
        private readonly string $key,
        private readonly array $application,
        private readonly string $programs,
    ) {
    }

    /**
     * Opens the application with the shared data of the case, which replaces the shared data of the application.
     *
     * @param array<string, mixed>|null $shared
     */
    public function open(?array $shared): App
    {
        $directory = "{$this->programs}/{$this->key}";
        self::autoload($directory);
        $routes = [];
        $names = array_map(
            static fn (array $route): string => (string) $route['name'],
            $this->application['manifest']['routes'],
        );
        foreach ($this->application['loaders'] ?? [] as $name => $spec) {
            if (in_array($name, $names, true)) {
                $routes[$name]['load'] = $this->loader($name, $spec);

                continue;
            }
            $routes[$this->routeOfRegion($name)]['regions'][$name] = $this->loader($name, $spec);
        }
        foreach ($this->application['actions'] ?? [] as $route => $spec) {
            $routes[$route]['post'] = $this->action($route, $spec);
        }
        $data = $shared ?? $this->application['shared'];

        $context = null;
        if (isset($this->application['context'])) {
            $context = function (mixed $selection): array {
                $this->calls[] = 'context';
                $this->selections[] = $selection;

                return $this->contextMap();
            };
        }

        return App::open(
            "{$directory}/manifest.json",
            "{$directory}/program",
            [
                'shared' => function () use ($data): array {
                    $this->calls[] = 'shared';

                    return $data;
                },
                'routes' => $routes,
            ],
            'Z',
            context: $context,
        );
    }

    /**
     * Maps the namespace that program.json of the program names to its directory php, as the autoload of Composer maps
     * the program of the fixtures (HY-48). Each namespace is mapped once.
     */
    private static function autoload(string $directory): void
    {
        $declaration = Json::file("{$directory}/program/program.json");
        $namespace = Json::string($declaration['namespace'] ?? null) . '\\';
        if (isset(self::$mapped[$namespace])) {
            return;
        }
        self::$mapped[$namespace] = true;
        spl_autoload_register(static function (string $class) use ($namespace, $directory): void {
            if (!str_starts_with($class, $namespace)) {
                return;
            }
            $file = "{$directory}/program/php/" . str_replace('\\', '/', substr($class, strlen($namespace))) . '.php';
            if (is_file($file)) {
                require $file;
            }
        });
    }

    /** Returns the masked token of the session, which a first response of the session created (HY-24). */
    public static function maskedToken(App $app, ArraySession $session): string
    {
        $app->handle(new Request('GET', '/', ['Accept' => 'text/html']), $session);
        $token = $session->get('_hyper_csrf');
        if (!is_string($token)) {
            throw new \LogicException('the first response of the session created no token');
        }

        return Csrf::masked($token);
    }

    /**
     * Sends a request of a case, with the form fields of the case and the token when the case states `csrf: true`.
     *
     * @param array<string, mixed> $request
     */
    public function send(App $app, ArraySession $session, array $request): Response
    {
        $headers = [];
        foreach ($request['headers'] ?? [] as $name => $value) {
            $headers[(string) $name] = (string) $value;
        }
        $form = [];
        foreach ($request['form'] ?? [] as $name => $value) {
            $form[(string) $name] = (string) $value;
        }
        if (($request['csrf'] ?? false) === true) {
            $form['_csrf'] = self::maskedToken($app, $session);
            $this->calls = [];
            $this->selections = [];
        }
        $target = (string) $request['target'];
        $body = http_build_query($form);

        return $app->handle(
            new Request(
                (string) $request['method'],
                Request::targetPath($target),
                $headers,
                Request::targetQuery($target),
                $body,
            ),
            $session,
        );
    }

    /** @return array<string, mixed> */
    private function contextMap(): array
    {
        $context = $this->application['context'] ?? null;
        if (!is_string($context)) {
            throw new \LogicException("application {$this->key} declares no context");
        }
        $map = json_decode($context, true, flags: JSON_THROW_ON_ERROR);
        if (!is_array($map)) {
            throw new \LogicException("the context of {$this->key} is not a map");
        }

        return $map;
    }

    /** @param array<string, mixed> $spec */
    private function loader(string $name, array $spec): \Closure
    {
        $stop = $spec['stop'] ?? null;
        if ($stop !== null) {
            if ($stop !== 'NotFound') {
                throw new \LogicException("loader {$name} stops with {$stop}, which the contract does not declare");
            }

            return static function (): array {
                throw new NotFound();
            };
        }
        $embed = in_array($name, $this->application['embedData'] ?? [], true);

        return function (Reply $reply) use ($name, $spec, $embed): array {
            if ($embed) {
                $reply->embedData();
            }

            return $spec;
        };
    }

    /** @param array<string, mixed> $spec */
    private function action(string $route, array $spec): \Closure
    {
        return function () use ($route, $spec): Result {
            $this->calls[] = "action:{$route}";
            if (array_key_exists('redirect', $spec)) {
                return Result::redirect((string) $spec['redirect']);
            }

            return Result::page((int) $spec['page'], (array) ($spec['data'] ?? []));
        };
    }

    private function routeOfRegion(string $region): string
    {
        foreach ($this->application['manifest']['routes'] as $route) {
            foreach ($route['regions'] ?? [] as $declared) {
                if ($declared['name'] === $region) {
                    return (string) $route['name'];
                }
            }
        }

        throw new \LogicException("region {$region} is declared by no route of {$this->key}");
    }
}
