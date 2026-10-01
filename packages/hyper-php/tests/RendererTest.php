<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Renderer;

/** HY-48: the server renders with the native extension when PHP loaded it, and otherwise with the generated program. */
final class RendererTest extends TestCase
{
    private const PROGRAM = __DIR__ . '/build/server';

    public function testUsesTheNativeExtensionWhenPhpLoadedIt(): void
    {
        $renderer = Renderer::open(self::PROGRAM, 'Z');

        self::assertSame(extension_loaded('polyspec_template') ? 'native' : 'generated', $renderer->engine);
        self::assertSame("<b>3</b>\n", $renderer->alone('side.tpl', [], ['count' => 3]));
    }

    public function testLoadsTheGeneratedProgramFromItsNamespace(): void
    {
        // HY-48: the build compiles the generated program into the namespace that the application chooses.
        if (extension_loaded('polyspec_template')) {
            self::markTestSkipped('the native extension loads no generated program');
        }
        $first = Renderer::open(self::PROGRAM, 'Z');
        $second = Renderer::open(self::PROGRAM, 'Z');

        self::assertTrue(class_exists('Polyspec\\Hyper\\Tests\\Program\\GeneratedProgram', false));
        self::assertFalse(class_exists('GeneratedProgram', false));
        self::assertSame($first->alone('side.tpl', [], ['count' => 1]), $second->alone('side.tpl', [], ['count' => 1]));
    }

    public function testRejectsADirectoryWithoutAProgram(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        Renderer::open(__DIR__ . '/fixtures', 'Z');
    }
}
