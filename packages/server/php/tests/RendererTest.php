<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Server\Renderer;

/** HY-48: the server renders with the generated program, through the API of the template package. */
final class RendererTest extends TestCase
{
    private const PROGRAM = __DIR__ . '/build/server';

    public function testTheGeneratedProgramIsLoadedThroughTheAutoload(): void
    {
        // HY-48: the build writes the generated program into the directory php as PSR-4 files of the namespace that
        // the application chooses, and the autoload of Composer loads its classes.
        self::assertFileExists(self::PROGRAM . '/php/GeneratedProgram.php');
        self::assertFileDoesNotExist(self::PROGRAM . '/program.php');
        $first = Renderer::open(self::PROGRAM, 'Z');
        $second = Renderer::open(self::PROGRAM, 'Z');

        self::assertTrue(class_exists('Polyspec\\Hyper\\Server\\Tests\\Program\\GeneratedProgram', false));
        self::assertFalse(class_exists('GeneratedProgram', false));
        self::assertSame(
            $first->alone('side.tpl', $first->bind([]), $first->bind(['count' => 1])),
            $second->alone('side.tpl', $second->bind([]), $second->bind(['count' => 1])),
        );
    }

    public function testAProgramWhoseNamespaceIsNotMappedFailsWithTheClassAndTheDirectory(): void
    {
        // HY-48: the server takes the generated program only through the autoload of Composer, so a namespace that
        // autoload.psr-4 of the application does not map fails with the class and the directory to map.
        $program = sys_get_temp_dir() . '/hyper-renderer-' . bin2hex(random_bytes(6));
        try {
            mkdir("{$program}/php", 0o700, true);
            mkdir("{$program}/templates");
            file_put_contents("{$program}/reads.json", '{"routes":{}}');
            file_put_contents("{$program}/build.json", '{"build":"' . str_repeat('1', 64) . '"}');
            file_put_contents("{$program}/program.json", '{"namespace":"Polyspec\\\\Hyper\\\\Server\\\\Tests\\\\Unmapped"}');
            try {
                Renderer::open($program, 'Z');
                self::fail('opened a program whose class the autoload does not load');
            } catch (\InvalidArgumentException $error) {
                self::assertStringContainsString(
                    'Polyspec\\Hyper\\Server\\Tests\\Unmapped\\GeneratedProgram',
                    $error->getMessage(),
                );
                self::assertStringContainsString("{$program}/php", $error->getMessage());
            }
        } finally {
            exec('rm -rf ' . escapeshellarg($program));
        }
    }
}
