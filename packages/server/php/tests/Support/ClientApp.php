<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

use Polyspec\Hyper\App;
use Polyspec\Hyper\Choice;
use Polyspec\Hyper\ClientRendering;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Result;

/**
 * HY-62: the fixture application that answers the client-rendered and the server-rendered pages of the fixture
 * manifest, with the base path and the host that the choice of a request chooses.
 *
 * @phpstan-type Options array{frameAncestors?: string, onResponse?: \Closure}
 */
final class ClientApp
{
    public const PROGRAM = __DIR__ . '/../build/server';
    public const SHELL = __DIR__ . '/../fixtures/shell/index.html';

    /**
     * @param Options $options further named arguments of App::open
     */
    public static function open(
        string $basePath,
        string $chosenHost,
        Counter $counter,
        ?ClientRendering $client = null,
        array $options = [],
    ): App {
        $client ??= new ClientRendering(
            self::SHELL,
            $basePath,
            fn (Request $request): Choice => new Choice($request->header('Host') === $chosenHost, null),
        );
        $app = App::open(...[
            'manifest' => __DIR__ . '/../fixtures/app.json',
            'program' => self::PROGRAM,
            'handlers' => [
                'regions' => ['side' => fn (Counter $counter): array => ['count' => $counter->count, 'note' => null]],
                'routes' => [
                    'home' => ['load' => fn (Counter $counter): array => ['name' => "n{$counter->count}"]],
                    'add' => ['post' => function (Request $request, Counter $counter): Result {
                        $counter->actions++;
                        if ($request->formString('name') === 'taken') {
                            return Result::page(409, ['name' => 'taken', 'error' => 'conflict']);
                        }
                        $counter->count++;

                        return Result::redirect('/');
                    }],
                    'list' => ['regions' => ['rows' => fn (): array => [
                        'items' => [],
                        'open' => false,
                        'mode' => 'a',
                        'view' => 'x',
                        'filter' => ['a' => 1],
                        'tags' => [],
                    ]]],
                    'item' => ['load' => fn (Request $request): array => ['id' => $request->param('id')]],
                ],
            ],
            'timezone' => '+09:00',
            'clientRendering' => $client,
            ...$options,
        ]);
        $app->bind(Counter::class, fn (): Counter => $counter);

        return $app;
    }
}
