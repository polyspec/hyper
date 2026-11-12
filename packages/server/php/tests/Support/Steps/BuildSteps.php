<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server\Tests\Support\Steps;

use Polyspec\Hyper\Server\Build;
use Polyspec\Hyper\Server\InvalidBuild;
use Polyspec\Hyper\Server\Renderer;
use Polyspec\Hyper\Server\Tests\CaseReader;
use Polyspec\Hyper\Server\Tests\Support\Json;

/**
 * HY-48.2, HY-125: the cases of contracts/build.json, the build id that a `build.json` file gives and the outputs of a
 * build that the open of a program needs.
 */
final class BuildSteps
{
    public static function read(CaseReader $case): void
    {
        $directory = sys_get_temp_dir() . '/hyper-build-' . bin2hex(random_bytes(6));
        mkdir($directory);
        $file = "{$directory}/build.json";
        try {
            // A null `text` is a missing file, unless `bytes` gives the bytes of the file as hexadecimal digits.
            $text = $case->input('text');
            if (is_string($text)) {
                file_put_contents($file, $text);
            } elseif ($text !== null) {
                throw new \UnexpectedValueException('the case field text is neither a string nor null');
            } elseif ($case->has('bytes')) {
                $bytes = $case->input('bytes');
                $hexadecimal = is_string($bytes) && preg_match('/^(?:[0-9a-f]{2})*$/D', $bytes) === 1;
                $data = $hexadecimal ? hex2bin($bytes) : false;
                if ($data === false) {
                    throw new \UnexpectedValueException('the case field bytes is not hexadecimal digits');
                }
                file_put_contents($file, $data);
            }
            $message = null;
            try {
                $build = Build::read($file);
                $error = null;
            } catch (InvalidBuild $failure) {
                $build = null;
                $error = str_contains($failure->getMessage(), $file) ? 'invalid-build' : $failure->getMessage();
                $message = $failure->getMessage();
            }
            $case->compare('build', $build);
            $case->compare('error', $error);
            $case->compare('message', $message);
        } finally {
            if (is_file($file)) {
                unlink($file);
            }
            rmdir($directory);
        }
    }

    /** The outputs of a program in the order in which the open needs them; true for a directory. */
    private const OUTPUTS = [
        'php' => true,
        'program.json' => false,
        'reads.json' => false,
        'build.json' => false,
        'templates' => true,
    ];

    /** Opens a program directory that holds every output but those of `missing`, and records the error of the open. */
    public static function outputs(CaseReader $case): void
    {
        $missing = Json::strings($case->input('missing'));
        foreach ($missing as $name) {
            if (!array_key_exists($name, self::OUTPUTS)) {
                throw new \UnexpectedValueException("{$name} is no output of a program");
            }
        }
        $directory = sys_get_temp_dir() . '/hyper-outputs-' . bin2hex(random_bytes(6));
        $program = "{$directory}/program";
        mkdir($program, 0o700, true);
        $created = [];
        try {
            foreach (self::OUTPUTS as $name => $isDirectory) {
                if (in_array($name, $missing, true)) {
                    continue;
                }
                $created[] = $name;
                $isDirectory ? mkdir("{$program}/{$name}") : file_put_contents("{$program}/{$name}", '');
            }
            $failure = null;
            try {
                Renderer::open($program, 'Z');
            } catch (\Throwable $error) {
                $failure = $error;
            }
            $case->outcome('open', $failure);
            $case->compare('message', str_replace($program, '{program}', $failure?->getMessage() ?? ''));
        } finally {
            foreach ($created as $name) {
                self::OUTPUTS[$name] ? rmdir("{$program}/{$name}") : unlink("{$program}/{$name}");
            }
            rmdir($program);
            rmdir($directory);
        }
    }
}
