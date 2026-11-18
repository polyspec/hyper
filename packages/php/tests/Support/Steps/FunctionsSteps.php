<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\App;
use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\Json;
use Polyspec\Hyper\Tests\Support\Untyped;
use Polyspec\Template\Environment;

/** HYC-24: the cases of contracts/functions.json. */
final class FunctionsSteps
{
    private const PROGRAMS = __DIR__ . '/../../../../../var/contract-programs';

    public static function cases(CaseReader $case): void
    {
        $application = Json::string($case->input('application'));
        $definition = Json::map(
            Json::map($case->input('applications'), 'the applications')[$application] ?? null,
            "the application {$application}",
        );
        $functions = self::functions($case->input('functions'), $case->input('functionKinds'));
        $routes = [];
        foreach (Json::map($definition['loaders'] ?? [], 'the loaders') as $route => $data) {
            $data = Json::map($data, "the loader {$route}");
            $routes[(string) $route] = ['load' => static fn (): array => $data];
        }
        $directory = self::PROGRAMS . "/{$application}";

        try {
            // A case hands the engine a value that is no function, which the type of App::open excludes, so the step
            // calls it without that type; the engine refuses the value (HYC-24).
            $app = Untyped::call(App::open(...))(
                "{$directory}/manifest.json",
                "{$directory}/program",
                ['routes' => $routes],
                // The time zone of the server that the case of HYC-24.10 reads, as the Node and the Python runner open.
                '+09:00',
                functions: $functions,
            );
        } catch (\Throwable $error) {
            // A case that states no openFails expects the open to succeed, so its error fails the case with the
            // message of the engine; without this the case compared nothing and reported only CASE_EMPTY (H34.6).
            if (!$case->has('openFails')) {
                throw $error;
            }
            $case->compare('openFails', $error);
            $case->compare('openError', $error->getMessage());

            return;
        }
        if (!$app instanceof App) {
            throw new \LogicException('App::open returned no application');
        }
        $case->compare('openFails', null);
        $case->compare('openError', null);

        $request = Json::map($case->input('request'), 'the request');
        $target = Json::string($request['target'] ?? null);
        $response = $app->handle(
            new Request(
                Json::string($request['method'] ?? null),
                Request::targetPath($target),
                Json::stringMap(Json::map($request['headers'] ?? null, 'the headers')),
            ),
            new ArraySession(),
        );
        $case->compare('status', $response->status);
        $case->compare('body', $response->body);
        $case->compare('bodyContains', $response->body);
    }

    /**
     * Maps each function of a case to the function of its kind, as functionKinds of the contract states them.
     *
     * @return array<string, callable|string>
     */
    private static function functions(mixed $kinds, mixed $declared): array
    {
        $declared = Json::map($declared, 'functionKinds');
        $functions = [];
        foreach (is_array($kinds) ? Json::stringMap($kinds) : [] as $name => $kind) {
            if (!array_key_exists($kind, $declared)) {
                throw new \LogicException("the kind {$kind} is not a functionKinds of the contract");
            }
            $functions[$name] = match ($kind) {
                // FUN-43: a host function receives the argument list as host values and the environment of the
                // render; the extension calls it with both, so a function of one parameter fails the open.
                'suffix' => static fn (array $arguments, Environment $environment): string
                    => Json::string($arguments[0] ?? null) . '!',
                // HYC-24.10: the second argument is the environment of the render, with the time zone of the server.
                'zone' => static fn (array $arguments, Environment $environment): string => $environment->timezone,
                'not_a_function' => 'x',
                default => throw new \LogicException("the kind {$kind} of the contract is unknown"),
            };
        }

        return $functions;
    }
}
