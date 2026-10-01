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

    public function testLoadsOneGeneratedProgramPerProcess(): void
    {
        if (extension_loaded('polyspec_template')) {
            self::markTestSkipped('the native extension loads no generated program');
        }
        Renderer::open(self::PROGRAM, 'Z');
        $other = sys_get_temp_dir() . '/hyper-renderer-test-' . getmypid();
        mkdir("{$other}/templates", 0o777, true);
        copy(self::PROGRAM . '/program.php', "{$other}/program.php");
        try {
            $this->expectException(\LogicException::class);
            Renderer::open($other, 'Z');
        } finally {
            unlink("{$other}/program.php");
            rmdir("{$other}/templates");
            rmdir($other);
        }
    }

    public function testRejectsADirectoryWithoutAProgram(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        Renderer::open(__DIR__ . '/fixtures', 'Z');
    }
}
