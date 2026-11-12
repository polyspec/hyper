<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\App;
use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\Json;
use Polyspec\Hyper\Tests\Support\Untyped;

/** HYC-24: the cases of contracts/functions.json. */
final class FunctionsSteps
{
    private const PROGRAMS = __DIR__ . '/../../../../../../var/contract-programs';

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
                'Z',
                functions: $functions,
            );
        } catch (\Throwable $error) {
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
                // FUN-43: a host function receives the argument list as host values.
                'suffix' => static fn (array $arguments): string => Json::string($arguments[0] ?? null) . '!',
                'not_a_function' => 'x',
                default => throw new \LogicException("the kind {$kind} of the contract is unknown"),
            };
        }

        return $functions;
    }
}
