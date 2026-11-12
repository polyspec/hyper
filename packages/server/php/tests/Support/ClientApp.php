<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

use Polyspec\Hyper\App;
use Polyspec\Hyper\ClientRendering;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Result;

/**
 * HY-62: the fixture application of contracts/client.json, which answers the client-rendered and the server-rendered
 * pages of the fixture manifest with the client fixture handlers.
 *
 * @phpstan-import-type Handlers from App
 * @phpstan-type Options array{bodyLimit?: int, frameAncestors?: string, onResponse?: \Closure, manifest?: string}
 */
final class ClientApp
{
    public const PROGRAM = __DIR__ . '/../build/server';
    public const MANIFEST = __DIR__ . '/../fixtures/app.json';
    public const SHELL = __DIR__ . '/../fixtures/shell/index.html';

    /**
     * Opens the application with the client rendering and binds the counter of the case.
     *
     * @param Options $options further named arguments of App::open
     * @param array<string, array<string, \Closure>> $representations the representation handlers of a case by the
     *     route name and the type (HY-118), whose entries the manifest of `$options` declares
     * @param ?\Closure(string, mixed): void $observe receives the name of each handler that runs and the selection
     *     value of its request; with it the application has a shared handler, which returns an empty map
     */
    public static function open(
        ClientRendering $client,
        Counter $counter,
        array $options = [],
        array $representations = [],
        ?\Closure $observe = null,
    ): App {
        $handlers = self::handlers($representations, $observe);
        $app = App::open(...[
            'manifest' => self::MANIFEST,
            'program' => self::PROGRAM,
            'handlers' => $handlers,
            'timezone' => '+09:00',
            'clientRendering' => $client,
            ...$options,
        ]);
        $app->bind(Counter::class, static fn (): Counter => $counter);

        return $app;
    }

    /**
     * Returns the client fixture handlers.
     *
     * @param array<string, array<string, \Closure>> $representations
     * @param ?\Closure(string, mixed): void $observe
     * @return Handlers
     */
    public static function handlers(array $representations = [], ?\Closure $observe = null): array
    {
        // Each handler first gives its name and the selection value of its request to `$observe`.
        $named = static function (string $name, \Closure $handler) use ($observe): \Closure {
            if ($observe === null) {
                return $handler;
            }

            return static function (Request $request, Counter $counter) use ($name, $handler, $observe): mixed {
                $observe($name, $request->selection());

                return $handler($request, $counter);
            };
        };
        $routes = [
            'home' => ['load' => $named(
                'load:home',
                static fn (Request $request, Counter $counter): array => ['name' => "n{$counter->count}"],
            )],
            'add' => ['post' => $named('action:add', static function (Request $request, Counter $counter): Result {
                $counter->actions++;
                if ($request->formString('name') === 'taken') {
                    return Result::page(409, ['name' => 'taken', 'error' => 'conflict']);
                }
                $counter->count++;

                return Result::redirect('/');
            })],
            'list' => ['regions' => ['rows' => $named(
                'region:rows',
                static fn (Request $request, Counter $counter): array => [
                    'items' => [],
                    'open' => false,
                    'mode' => 'a',
                    'view' => 'x',
                    'filter' => ['a' => 1],
                    'tags' => [],
                ],
            )]],
            'item' => ['load' => $named(
                'load:item',
                static fn (Request $request, Counter $counter): array => ['id' => $request->param('id')],
            )],
        ];
        foreach ($representations as $route => $handlers) {
            $routes[$route] = [...$routes[$route] ?? [], 'representations' => $handlers];
        }
        $handlers = [
            'regions' => ['side' => $named(
                'region:side',
                static fn (Request $request, Counter $counter): array => ['count' => $counter->count, 'note' => null],
            )],
            'routes' => $routes,
        ];
        if ($observe !== null) {
            $handlers['shared'] = static function (Request $request) use ($observe): array {
                $observe('shared', $request->selection());

                return [];
            };
        }

        return $handlers;
    }
}
