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
 * (HY-124). The program of each application is built by scripts/contract-programs.mts into var/contract-programs.
 * The application is the decoded value of the contract, whose members are checked where they are read.
 */
final class ContextRun
{
    /** @var array<string, true> the namespaces whose programs the autoloader maps */
    private static array $mapped = [];

    /** @var list<string> the calls of the handlers in order: `action:<route>`, `context` and `shared` */
    public array $calls = [];

    /** @var list<mixed> the selection values that the context handler received */
    public array $selections = [];

    /** the failure that the response hook received with the last response (HY-60), or null */
    public ?string $failure = null;

    /** @param array<array-key, mixed> $application */
    public function __construct(
        private readonly string $key,
        private readonly array $application,
        private readonly string $programs,
    ) {
    }

    /**
     * Opens the application with the shared data of the case, which replaces the shared data of the application; an
     * application that declares no shared data and a case that gives none opens with no shared handler.
     *
     * @param array<array-key, mixed>|null $shared
     * @param array<string, callable|string> $functions the host functions of the case (HYC-24)
     * @param ?string $context the JSON text of the context of the case, which replaces the context of the application
     */
    public function open(?array $shared, array $functions = [], ?string $context = null): App
    {
        $directory = "{$this->programs}/{$this->key}";
        self::autoload($directory);
        $routes = [];
        $names = array_map(
            static fn (array $route): string => self::string($route['name'] ?? null, 'a route name'),
            $this->routes(),
        );
        // An absent member declares none; a member that is present must have its type.
        foreach (self::map($this->application['loaders'] ?? null, 'the loaders') as $name => $spec) {
            // PHP keeps a decimal name as an integer key; the name is its string.
            $name = (string) $name;
            $loader = $this->loader($name, self::map($spec, "the loader {$name}"));
            if (in_array($name, $names, true)) {
                $routes[$name]['load'] = $loader;

                continue;
            }
            $routes[$this->routeOfRegion($name)]['regions'][$name] = $loader;
        }
        if (array_key_exists('actions', $this->application)) {
            foreach (self::map($this->application['actions'], 'the actions') as $route => $spec) {
                // PHP keeps a decimal name as an integer key; the name is its string.
                $route = (string) $route;
                $routes[$route]['post'] = $this->action($route, self::map($spec, "the action of {$route}"));
            }
        }
        $data = $shared ?? (array_key_exists('shared', $this->application)
            ? self::map($this->application['shared'], 'the shared data')
            : null);
        $handlers = ['routes' => $routes];
        if ($data !== null) {
            $handlers['shared'] = function () use ($data): array {
                $this->calls[] = 'shared';

                return $data;
            };
        }

        $text = $context ?? (array_key_exists('context', $this->application)
            ? self::string($this->application['context'], 'the context')
            : null);
        $handler = null;
        if ($text !== null) {
            // The handler returns the decoded text as it is, also a value that is not a map, so that the server
            // checks it (HY-124).
            $value = json_decode($text, true, flags: JSON_THROW_ON_ERROR);
            $handler = function (mixed $selection) use ($value): mixed {
                $this->calls[] = 'context';
                $this->selections[] = $selection;

                return $value;
            };
        }

        return App::open(
            "{$directory}/manifest.json",
            "{$directory}/program",
            $handlers,
            'Z',
            onResponse: function (Request $request, Response $response, float $elapsed, Reply $reply, ?string $failure): void {
                $this->failure = $failure;
            },
            // @phpstan-ignore argument.type (a case hands the server a value that is not a map, which the type of the handler excludes)
            context: $handler,
            // @phpstan-ignore argument.type (the cases of functions.json hand the engine a value that is not a function, which it refuses)
            functions: $functions,
        );
    }

    /**
     * Maps the namespace that program.json of the program names to its directory php, as the autoload of Composer maps
     * the program of the fixtures (HY-48). Each namespace is mapped once.
     */
    public static function autoload(string $directory): void
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
     * @param array<array-key, mixed> $request
     */
    public function send(App $app, ArraySession $session, array $request): Response
    {
        $headers = self::texts($request, 'headers');
        $form = array_key_exists('form', $request) ? self::texts($request, 'form') : [];
        $csrf = $request['csrf'] ?? false;
        if (!is_bool($csrf)) {
            throw new \UnexpectedValueException('the request field csrf is not a boolean');
        }
        if ($csrf) {
            $form['_csrf'] = self::maskedToken($app, $session);
            $this->calls = [];
            $this->selections = [];
        }
        $target = self::text($request, 'target');
        $body = http_build_query($form);

        return $app->handle(
            new Request(
                self::text($request, 'method'),
                Request::targetPath($target),
                $headers,
                Request::targetQuery($target),
                $body,
            ),
            $session,
        );
    }

    /**
     * Returns a string field of a request, and fails for any other value.
     *
     * @param array<array-key, mixed> $request
     */
    private static function text(array $request, string $field): string
    {
        $value = $request[$field] ?? null;
        if (!is_string($value)) {
            throw new \UnexpectedValueException("the request field {$field} is not a string");
        }

        return $value;
    }

    /**
     * Returns a field of a request that maps names to strings, and fails for any other value.
     *
     * @param array<array-key, mixed> $request
     * @return array<string, string>
     */
    private static function texts(array $request, string $field): array
    {
        $value = $request[$field] ?? null;
        // Plain gives an empty JSON object as stdClass, so that it differs from an empty list.
        if ($value instanceof \stdClass && get_object_vars($value) === []) {
            return [];
        }
        if (!is_array($value) || ($value !== [] && array_is_list($value))) {
            throw new \UnexpectedValueException("the request field {$field} is not a map");
        }
        $texts = [];
        foreach ($value as $name => $text) {
            if (!is_string($name) || !is_string($text)) {
                throw new \UnexpectedValueException("the request field {$field} holds a value that is not a string");
            }
            $texts[$name] = $text;
        }

        return $texts;
    }

    /** Returns a string of the application, and fails for any other value. */
    private static function string(mixed $value, string $what): string
    {
        if (!is_string($value)) {
            throw new \UnexpectedValueException("{$what} is not a string");
        }

        return $value;
    }

    /**
     * Returns a list of strings of the application, and fails for any other value.
     *
     * @return list<string>
     */
    private static function strings(mixed $value, string $what): array
    {
        if (!is_array($value) || !array_is_list($value)) {
            throw new \UnexpectedValueException("{$what} is not a list of strings");
        }

        return array_map(static fn (mixed $item): string => self::string($item, "an item of {$what}"), $value);
    }

    /**
     * Returns a map of the application, and fails for any other value. Plain gives an empty JSON object as stdClass,
     * so that it differs from an empty list.
     *
     * @return array<array-key, mixed>
     */
    private static function map(mixed $value, string $what): array
    {
        if ($value instanceof \stdClass && get_object_vars($value) === []) {
            return [];
        }
        if (!is_array($value) || ($value !== [] && array_is_list($value))) {
            throw new \UnexpectedValueException("{$what} is not a map");
        }

        return $value;
    }

    /**
     * Returns a map of the application whose keys are names, and fails for any other value; a decimal name, which PHP
     * keeps as an integer key, is not a name of the data of a page.
     *
     * @return array<string, mixed>
     */
    private static function stringMap(mixed $value, string $what): array
    {
        $names = [];
        foreach (self::map($value, $what) as $key => $item) {
            if (!is_string($key)) {
                throw new \UnexpectedValueException("{$what} has a key that is not a name");
            }
            $names[$key] = $item;
        }

        return $names;
    }

    /** @param array<array-key, mixed> $spec */
    private function loader(string $name, array $spec): \Closure
    {
        $stop = $spec['stop'] ?? null;
        if ($stop !== null) {
            if ($stop !== 'NotFound') {
                throw new \UnexpectedValueException("loader {$name} stops with a value other than NotFound");
            }

            return static function (): array {
                throw new NotFound();
            };
        }
        $embed = array_key_exists('embedData', $this->application)
            && in_array($name, self::strings($this->application['embedData'], 'embedData'), true);

        return function (Reply $reply) use ($spec, $embed): array {
            if ($embed) {
                $reply->embedData();
            }

            return $spec;
        };
    }

    /** @param array<array-key, mixed> $spec */
    private function action(string $route, array $spec): \Closure
    {
        return function () use ($route, $spec): Result {
            $this->calls[] = "action:{$route}";
            if (array_key_exists('redirect', $spec)) {
                return Result::redirect(self::string($spec['redirect'], "the redirect of {$route}"));
            }
            $page = $spec['page'] ?? null;
            if (!is_int($page)) {
                throw new \UnexpectedValueException("the action of {$route} has no redirect and no integer page");
            }

            return Result::page($page, self::stringMap($spec['data'] ?? null, "the data of the action of {$route}"));
        };
    }

    /**
     * Returns the routes of the manifest of the application, and fails for any other value.
     *
     * @return list<array<array-key, mixed>>
     */
    private function routes(): array
    {
        $routes = self::map($this->application['manifest'] ?? null, 'the manifest')['routes'] ?? null;
        if (!is_array($routes) || !array_is_list($routes)) {
            throw new \UnexpectedValueException('the routes of the manifest are not a list');
        }

        return array_map(static fn (mixed $route): array => self::map($route, 'a route'), $routes);
    }

    private function routeOfRegion(string $region): string
    {
        foreach ($this->routes() as $route) {
            $regions = array_key_exists('regions', $route) ? $route['regions'] : [];
            if (!is_array($regions) || !array_is_list($regions)) {
                throw new \UnexpectedValueException('the regions of a route are not a list');
            }
            foreach ($regions as $declared) {
                if ((self::map($declared, 'a region')['name'] ?? null) === $region) {
                    return self::string($route['name'], 'a route name');
                }
            }
        }

        throw new \LogicException("region {$region} is declared by no route of {$this->key}");
    }
}
