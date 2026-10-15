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
        self::assertSame("<b>3</b>\n", $renderer->alone('side.tpl', $renderer->bind([]), $renderer->bind(['count' => 3])));
    }

    public function testLoadsTheGeneratedProgramFromItsNamespace(): void
    {
        // HY-48: the build writes the generated program into the directory php as PSR-4 files of the namespace that
        // the application chooses, and the autoload of Composer loads its classes.
        if (extension_loaded('polyspec_template')) {
            self::markTestSkipped('the native extension loads no generated program');
        }
        self::assertFileExists(self::PROGRAM . '/php/GeneratedProgram.php');
        self::assertFileDoesNotExist(self::PROGRAM . '/program.php');
        $first = Renderer::open(self::PROGRAM, 'Z');
        $second = Renderer::open(self::PROGRAM, 'Z');

        self::assertTrue(class_exists('Polyspec\\Hyper\\Tests\\Program\\GeneratedProgram', false));
        self::assertFalse(class_exists('GeneratedProgram', false));
        self::assertSame($first->alone('side.tpl', $first->bind([]), $first->bind(['count' => 1])), $second->alone('side.tpl', $second->bind([]), $second->bind(['count' => 1])));
    }

    public function testRejectsADirectoryWithoutAProgram(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        Renderer::open(__DIR__ . '/fixtures', 'Z');
    }

    public function testNamesTheFirstMissingFileOfAProgram(): void
    {
        // HY-48: a missing build names the missing file when the application opens.
        $root = sys_get_temp_dir() . '/hyper-renderer-' . bin2hex(random_bytes(6));
        $files = ['php', 'program.json', 'reads.json', 'templates'];
        $directories = ['php', 'templates'];
        try {
            foreach ($files as $missing) {
                $program = "{$root}/without-" . strtr($missing, '.', '-');
                mkdir($program, 0o700, true);
                foreach ($files as $file) {
                    if ($file === $missing) {
                        continue;
                    }
                    if (in_array($file, $directories, true)) {
                        mkdir("{$program}/{$file}");
                    } else {
                        file_put_contents("{$program}/{$file}", '');
                    }
                }
                try {
                    Renderer::open($program, 'Z');
                    self::fail("opened a program without {$missing}");
                } catch (\InvalidArgumentException $error) {
                    self::assertStringContainsString("{$program}/{$missing}", $error->getMessage());
                }
            }
        } finally {
            exec('rm -rf ' . escapeshellarg($root));
        }
    }

    public function testNamesTheClassThatTheAutoloadDoesNotLoad(): void
    {
        // HY-48: the server takes the generated program only through the autoload of Composer, so a namespace that
        // autoload.psr-4 of the application does not map fails with the class and the directory to map.
        if (extension_loaded('polyspec_template')) {
            self::markTestSkipped('the native extension loads no generated program');
        }
        $program = sys_get_temp_dir() . '/hyper-renderer-' . bin2hex(random_bytes(6));
        try {
            mkdir("{$program}/php", 0o700, true);
            mkdir("{$program}/templates");
            file_put_contents("{$program}/reads.json", '{"routes":{}}');
            file_put_contents("{$program}/program.json", '{"namespace":"Polyspec\\\\Hyper\\\\Tests\\\\Unmapped"}');
            try {
                Renderer::open($program, 'Z');
                self::fail('opened a program whose class the autoload does not load');
            } catch (\InvalidArgumentException $error) {
                self::assertStringContainsString('Polyspec\\Hyper\\Tests\\Unmapped\\GeneratedProgram', $error->getMessage());
                self::assertStringContainsString("{$program}/php", $error->getMessage());
            }
        } finally {
            exec('rm -rf ' . escapeshellarg($program));
        }
    }
}
