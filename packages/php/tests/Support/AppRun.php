<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

use Polyspec\Hyper\App;
use Polyspec\Hyper\BadRequest;
use Polyspec\Hyper\Forbidden;
use Polyspec\Hyper\NotFound;
use Polyspec\Hyper\Redirect;
use Polyspec\Hyper\Reply;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Result;
use Polyspec\Hyper\Tests\Support\Steps\ReplySteps;

/**
 * Opens one application of contracts/app.json, whose handlers are lists of steps of a closed vocabulary, and records
 * the calls of its handlers, the values that they observe and the services that they use. The program of each
 * application is built by scripts/contract-programs.mts into var/contract-programs.
 */
final class AppRun
{
    private const OPTIONS = [
        'basePath',
        'https',
        'frameAncestors',
        'bodyLimit',
        'fileLimit',
        'valueLimit',
        'partLimit',
        'responseLimit',
        'formTypes',
    ];
    private const STEPS = ['calls', 'observe', 'add', 'warn'];
    private const RESULTS = ['return', 'stop', 'throw', 'redirect', 'page'];

    /** @var list<string> the calls of the handlers in the order in which they start */
    public array $calls = [];

    /** @var list<array{0: string, 1: mixed}> the pairs of a handler and a value that a step `observe` read */
    public array $observed = [];

    /** How many times the server enumerated the entries of the values of the kind `countingMap`. */
    public int $reads = 0;

    /** The calls of the response hook. */
    public readonly Reports $reports;

    /** @var array<string, object> the record of each service whose factory was called */
    private array $created = [];

    /**
     * @param array<array-key, mixed> $application an application of the fixture `applications`
     * @param array<array-key, mixed> $handlers the handlers of the case, merged over those of the application
     * @param array<array-key, mixed> $options the options of the case, merged over those of the application
     */
    public function __construct(
        private readonly array $application,
        private readonly array $handlers,
        private readonly array $options,
    ) {
        $this->reports = new Reports();
    }

    /** Opens the application from its manifest file and its program directory, and binds its services. */
    public function open(string $manifest, string $program): App
    {
        $given = Json::map($this->application['handlers'] ?? [], 'the handlers of the application');
        $handlers = [];
        foreach (['shared' => 'shared'] as $key => $name) {
            $steps = array_key_exists($key, $this->handlers) ? $this->handlers[$key] : ($given[$key] ?? null);
            if ($steps !== null) {
                $handlers[$key] = $this->handler($name, $steps);
            }
        }
        $regions = self::merged($given['regions'] ?? [], $this->handlers['regions'] ?? [], 'the region handlers');
        foreach ($regions as $region => $steps) {
            if ($steps !== null) {
                $handlers['regions'][(string) $region] = $this->handler("region:{$region}", $steps);
            }
        }
        $routes = Json::map($given['routes'] ?? [], 'the route handlers of the application');
        foreach (Json::map($this->handlers['routes'] ?? [], 'the route handlers of the case') as $route => $entry) {
            $base = Json::map($routes[$route] ?? [], "the handlers of the route {$route}");
            $entry = Json::map($entry, "the handlers of the route {$route}");
            foreach ($entry as $key => $value) {
                $base[$key] = $key === 'regions'
                    ? self::merged($base['regions'] ?? [], $value, "the region handlers of the route {$route}")
                    : $value;
            }
            $routes[$route] = $base;
        }
        foreach ($routes as $route => $entry) {
            $built = [];
            foreach (Json::map($entry, "the handlers of the route {$route}") as $key => $value) {
                if ($key === 'load' && $value !== null) {
                    $built['load'] = $this->handler("load:{$route}", $value);
                } elseif ($key === 'post' && $value !== null) {
                    $built['post'] = $this->handler("action:{$route}", $value);
                } elseif ($key === 'regions') {
                    foreach (Json::map($value, "the region handlers of the route {$route}") as $region => $steps) {
                        if ($steps !== null) {
                            $built['regions'][(string) $region] = $this->handler("region:{$region}", $steps);
                        }
                    }
                } elseif (!in_array($key, ['load', 'post'], true)) {
                    throw new \UnexpectedValueException("{$key} is no handler of the route {$route}");
                }
            }
            $handlers['routes'][(string) $route] = $built;
        }

        $arguments = [
            'manifest' => $manifest,
            'program' => $program,
            'handlers' => $handlers,
            'timezone' => Json::string($this->application['timezone'] ?? '+09:00'),
            'onResponse' => $this->reports->hook(),
        ];
        if (array_key_exists('context', $this->application)) {
            // The handler returns the decoded text (HY-124), which is a map in every application of the file.
            $value = [];
            $decoded = Json::value(Json::string($this->application['context']));
            foreach (Json::array($decoded) as $key => $item) {
                $value[(string) $key] = $item;
            }
            $arguments['context'] = function (mixed $selection) use ($value): array {
                $this->calls[] = 'context';

                return $value;
            };
        }
        // Each option is passed with the type of its parameter; an option that the maps do not hold is not passed.
        $options = [
            ...Json::map($this->application['options'] ?? [], 'the options of the application'),
            ...$this->options,
        ];
        $unknown = array_diff(array_keys($options), self::OPTIONS);
        if ($unknown !== []) {
            throw new \UnexpectedValueException(implode(', ', $unknown) . ' is no option of an application');
        }
        if (array_key_exists('basePath', $options)) {
            $arguments['basePath'] = Json::string($options['basePath']);
        }
        if (array_key_exists('https', $options)) {
            $arguments['https'] = $options['https'] === true;
        }
        if (array_key_exists('frameAncestors', $options)) {
            $arguments['frameAncestors'] = Json::string($options['frameAncestors']);
        }
        if (array_key_exists('bodyLimit', $options)) {
            $arguments['bodyLimit'] = self::integer($options['bodyLimit']);
        }
        if (array_key_exists('fileLimit', $options)) {
            $arguments['fileLimit'] = self::integer($options['fileLimit']);
        }
        if (array_key_exists('valueLimit', $options)) {
            $arguments['valueLimit'] = self::integer($options['valueLimit']);
        }
        if (array_key_exists('partLimit', $options)) {
            $arguments['partLimit'] = self::integer($options['partLimit']);
        }
        if (array_key_exists('responseLimit', $options)) {
            $arguments['responseLimit'] = self::integer($options['responseLimit']);
        }
        if (array_key_exists('formTypes', $options)) {
            $arguments['formTypes'] = Json::strings($options['formTypes']);
        }
        $app = App::open(...$arguments);
        foreach (Json::map($this->application['services'] ?? [], 'the services') as $name => $members) {
            $class = self::serviceClass((string) $name);
            $members = Json::map($members, "the members of the service {$name}");
            $app->bind($class, function () use ($class, $name, $members): object {
                $record = new $class();
                foreach ($members as $member => $value) {
                    if (!property_exists($record, (string) $member) || !is_int($value)) {
                        throw new \UnexpectedValueException("the service {$name} has no integer member {$member}");
                    }
                    $record->{$member} = $value;
                }

                return $this->created[(string) $name] = $record;
            });
        }

        return $app;
    }

    /** Forgets the calls, the observations and the reports of the requests so far; the services keep their state. */
    public function reset(): void
    {
        $this->calls = [];
        $this->observed = [];
        $this->reads = 0;
        $this->reports->calls = [];
    }

    /**
     * Returns the stated members of the record of each service of the application, or null for a service whose factory
     * was not called.
     *
     * @return array<string, ?array<string, mixed>>
     */
    public function serviceValues(): array
    {
        $values = [];
        foreach (Json::map($this->application['services'] ?? [], 'the services') as $name => $members) {
            $record = $this->created[(string) $name] ?? null;
            $values[(string) $name] = null;
            if ($record !== null) {
                $values[(string) $name] = [];
                foreach (array_keys(Json::map($members, 'the members of a service')) as $member) {
                    $values[(string) $name][(string) $member] = $record->{$member};
                }
            }
        }

        return $values;
    }

    /**
     * Returns the handler of a list of steps. The closure names each service that the steps use by the class of a
     * parameter (HY-105.4), so there is one closure shape for each set of services.
     */
    private function handler(string $name, mixed $steps): \Closure
    {
        $steps = array_map(
            static fn (mixed $step): array => Json::map($step, "a step of the handler {$name}"),
            Json::list($steps),
        );
        foreach ($steps as $index => $step) {
            $words = array_values(array_intersect(
                [...self::STEPS, ...self::RESULTS],
                array_map(strval(...), array_keys($step)),
            ));
            $word = $words[0] ?? null;
            // A redirect stop and a page carry `redirect` and `data` beside their word.
            $result = array_key_exists('stop', $step) || in_array($word, self::RESULTS, true);
            if ($word === null || $result !== ($index === count($steps) - 1)) {
                throw new \UnexpectedValueException("the handler {$name} is not steps that end with one result");
            }
        }
        if ($steps === []) {
            throw new \UnexpectedValueException("the handler {$name} has no result");
        }
        $run = fn (Request $request, Reply $reply, object ...$services): mixed => $this->perform(
            $name,
            $steps,
            $request,
            $reply,
            $services,
        );
        $used = self::servicesOf($steps);
        sort($used);

        return match (implode(',', $used)) {
            '' => static fn (Request $request, Reply $reply): mixed => $run($request, $reply),
            'counter' => static fn (Request $request, Reply $reply, Counter $counter): mixed => $run(
                $request,
                $reply,
                counter: $counter,
            ),
            'mailer' => static fn (Request $request, Reply $reply, Mailer $mailer): mixed => $run(
                $request,
                $reply,
                mailer: $mailer,
            ),
            'counter,mailer' => static fn (
                Request $request,
                Reply $reply,
                Counter $counter,
                Mailer $mailer,
            ): mixed => $run($request, $reply, counter: $counter, mailer: $mailer),
            default => throw new \UnexpectedValueException("the handler {$name} uses an unknown service"),
        };
    }

    /**
     * Performs the steps of a handler in order and returns or throws its result.
     *
     * @param list<array<array-key, mixed>> $steps
     * @param array<array-key, object> $services
     */
    private function perform(string $name, array $steps, Request $request, Reply $reply, array $services): mixed
    {
        $this->calls[] = $name;
        $value = fn (mixed $data): mixed => $this->value($data, $request, $services);
        foreach ($steps as $step) {
            if (array_key_exists('calls', $step)) {
                foreach (Json::list($step['calls']) as $call) {
                    $call = Json::list($call);
                    ReplySteps::call($reply, Json::string($call[0] ?? null), array_map(
                        static fn (string $text): mixed => Json::value($text),
                        Json::strings($call[1] ?? null),
                    ));
                }
            } elseif (array_key_exists('observe', $step)) {
                $this->observed[] = [$name, $value($step['observe'])];
            } elseif (array_key_exists('add', $step)) {
                $add = Json::list($step['add']);
                $service = $services[Json::string($add[0] ?? null)];
                $member = Json::string($add[1] ?? null);
                $held = property_exists($service, $member) ? $service->{$member} : null;
                if (!is_int($add[2] ?? null) || !is_int($held)) {
                    throw new \UnexpectedValueException("the handler {$name} adds no integer to a member of a service");
                }
                $service->{$member} = $held + $add[2];
            } elseif (array_key_exists('warn', $step)) {
                trigger_error(Json::string($step['warn']), E_USER_WARNING);
            } elseif (array_key_exists('stop', $step)) {
                throw match ($step['stop']) {
                    'NotFound' => new NotFound(),
                    'Forbidden' => new Forbidden(),
                    'BadRequest' => new BadRequest(),
                    'Redirect' => new Redirect(self::redirect($step)),
                    default => new \UnexpectedValueException("the handler {$name} stops with an unknown kind"),
                };
            } elseif (array_key_exists('throw', $step)) {
                $thrown = Json::map($step['throw'], 'the member throw');
                throw match ($thrown['class'] ?? null) {
                    'OrmError' => new OrmException(Json::string($thrown['code'] ?? null)),
                    'Error' => new \RuntimeException(Json::string($thrown['message'] ?? null)),
                    default => new \UnexpectedValueException("the handler {$name} throws an unknown class"),
                };
            } elseif (array_key_exists('redirect', $step)) {
                return self::redirect($step);
            } elseif (array_key_exists('page', $step)) {
                $status = $step['page'];
                $data = $value($step['data'] ?? []);
                if (!is_int($status) || !is_array($data)) {
                    throw new \UnexpectedValueException("the handler {$name} returns a page without a status or a map");
                }

                return Result::page($status, $data);
            } else {
                return $value($step['return']);
            }
        }

        throw new \LogicException("the handler {$name} has no result");
    }

    /**
     * Returns the redirect result of a step, with its flash values and its changed topics in their order.
     *
     * @param array<array-key, mixed> $step
     */
    private static function redirect(array $step): Result
    {
        $result = Result::redirect(Json::string($step['redirect'] ?? null));
        foreach (Json::list($step['flashes'] ?? []) as $flash) {
            $flash = Json::strings($flash);
            $result = $result->flash($flash[0], Json::value($flash[1]));
        }
        foreach (Json::strings($step['topics'] ?? []) as $topic) {
            $result = $result->changed($topic);
        }

        return $result;
    }

    /**
     * Returns the host value of a data value of a handler: a map is an array, an empty map the empty array, and a map
     * with the key `$` is the value of its expression. The expressions are evaluated in document order.
     *
     * @param array<array-key, object> $services
     */
    private function value(mixed $data, Request $request, array $services): mixed
    {
        if ($data instanceof \stdClass) {
            return [];
        }
        if (!is_array($data)) {
            return $data;
        }
        $next = fn (mixed $item): mixed => $this->value($item, $request, $services);
        if (!array_key_exists('$', $data)) {
            return array_map($next, $data);
        }
        $name = static fn (): string => Json::string($data['name'] ?? null);

        return match ($data['$']) {
            'param' => $request->param($name()),
            'queryInt' => $request->queryInt($name(), is_int($data['default'] ?? null) ? $data['default'] : 0),
            'formString' => $request->formString($name()),
            'flash' => $request->flash($name()),
            'header' => $request->header($name()),
            'path' => $request->path(),
            'method' => $request->method,
            'selection' => $request->selection(),
            'browser' => $request->browser(),
            'csrfToken' => $request->csrfToken(),
            'service' => $services[$name()]->{Json::string($data['member'] ?? null)},
            'text' => implode('', array_map(
                static function (mixed $part) use ($next): string {
                    $part = $next($part);
                    if ($part !== null && !is_string($part) && !is_int($part)) {
                        throw new \UnexpectedValueException('a part of a text is no text and no integer');
                    }

                    return (string) $part;
                },
                Json::list($data['parts'] ?? null),
            )),
            'kind' => $this->kind($name()),
            default => throw new \UnexpectedValueException('the expression of a handler is unknown'),
        };
    }

    /** Returns a new value of a kind of the fixture `valueKinds`. */
    private function kind(string $name): mixed
    {
        return match ($name) {
            'countingMap' => new class ($this) implements \JsonSerializable {
                public function __construct(private readonly AppRun $run)
                {
                }

                /** @return array<string, int> */
                public function jsonSerialize(): array
                {
                    $this->run->reads++;

                    return ['a' => 1];
                }
            },
            'date' => new \DateTimeImmutable('2026-01-01T00:00:00Z'),
            'applicationObject' => new class () {
                public int $id = 1;
            },
            'plainObject' => (object) ['a' => 1],
            'jsonSerializable' => new class () implements \JsonSerializable {
                /** @return array<string, int> */
                public function jsonSerialize(): array
                {
                    return ['a' => 1];
                }
            },
            'notANumber' => NAN,
            'largeFloat' => 1e20,
            'floatTwoTo53' => 9007199254740992.0,
            'loneSurrogate' => "\xED\xA0\x80",
            'function' => static fn (): int => 1,
            default => throw new \UnexpectedValueException("the value kind {$name} is unknown"),
        };
    }

    /**
     * Returns the names of the services that the steps of a handler use, through `add` and the expression `service`.
     *
     * @return list<string>
     */
    private static function servicesOf(mixed $value): array
    {
        if (!is_array($value)) {
            return [];
        }
        $names = [];
        if (($value['$'] ?? null) === 'service') {
            $names[] = Json::string($value['name'] ?? null);
        }
        if (is_array($value['add'] ?? null)) {
            $names[] = Json::string($value['add'][0] ?? null);
        }
        foreach ($value as $item) {
            $names = [...$names, ...self::servicesOf($item)];
        }

        return array_values(array_unique($names));
    }

    private static function integer(mixed $value): int
    {
        return is_int($value) ? $value : throw new \UnexpectedValueException('an option is no integer');
    }

    /** @return class-string */
    private static function serviceClass(string $name): string
    {
        return match ($name) {
            'counter' => Counter::class,
            'mailer' => Mailer::class,
            default => throw new \UnexpectedValueException("the service {$name} is unknown"),
        };
    }

    /**
     * Returns the handlers of the second map over those of the first, by name.
     *
     * @return array<array-key, mixed>
     */
    private static function merged(mixed $base, mixed $over, string $what): array
    {
        return array_replace(Json::map($base, $what), Json::map($over, $what));
    }
}
