<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\App;
use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Result;

/** HY-62: the selection value of a request of an application without client rendering. */
final class ClientTest extends TestCase
{
    private const PROGRAM = __DIR__ . '/build/server';

    public function testARequestOfAnApplicationWithoutTheDeclarationHasTheValueNull(): void
    {
        // HY-62
        $seen = [];
        $app = App::open(
            manifest: __DIR__ . '/fixtures/app.json',
            program: self::PROGRAM,
            handlers: ['routes' => [
                'item' => ['load' => function (Request $request) use (&$seen): array {
                    $seen[] = $request->selection();

                    return ['id' => $request->param('id')];
                }],
                'add' => ['post' => fn (): Result => Result::redirect('/')],
            ]],
            timezone: '+09:00',
        );
        $app->handle(new Request('GET', '/items/7'), new ArraySession());
        self::assertSame([null], $seen);
    }
}
