<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Renderer;

/** HY-48.15: the server renders the directory templates with the Engine and the FsLoader of the template extension. */
final class RendererTest extends TestCase
{
    private const PROGRAM = __DIR__ . '/build/server';

    public function testTheTemplatesOfTheProgramRenderWithoutTheGeneratedProgram(): void
    {
        // HY-48.15: a program directory without php and program.json opens and renders from its templates.
        $program = sys_get_temp_dir() . '/hyper-renderer-' . bin2hex(random_bytes(6));
        try {
            mkdir("{$program}/templates", 0o700, true);
            file_put_contents("{$program}/templates/side.tpl", '<p>{= count}</p>');
            file_put_contents("{$program}/reads.json", '{"routes":{}}');
            file_put_contents("{$program}/build.json", '{"build":"' . str_repeat('1', 64) . '"}');
            $renderer = Renderer::open($program, 'Z');

            self::assertSame(
                '<p>1</p>',
                $renderer->alone('side.tpl', $renderer->bind([]), $renderer->bind(['count' => 1])),
            );
        } finally {
            exec('rm -rf ' . escapeshellarg($program));
        }
    }

    public function testTwoRenderersOfOneProgramRenderTheSameBytes(): void
    {
        $first = Renderer::open(self::PROGRAM, 'Z');
        $second = Renderer::open(self::PROGRAM, 'Z');

        self::assertSame(
            $first->alone('side.tpl', $first->bind([]), $first->bind(['count' => 1])),
            $second->alone('side.tpl', $second->bind([]), $second->bind(['count' => 1])),
        );
    }
}
