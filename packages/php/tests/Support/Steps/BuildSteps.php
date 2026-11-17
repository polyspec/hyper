<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\Build;
use Polyspec\Hyper\Renderer;
use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\CaseRules;
use Polyspec\Hyper\Tests\Support\Json;

/**
 * HY-48.2, HY-125: the cases of contracts/build.json, the build id that a `build.json` file gives and the outputs of a
 * build that the open of a program needs.
 */
final class BuildSteps
{
    public static function read(CaseReader $case): void
    {
        $directory = sys_get_temp_dir() . '/hyper-cli-' . bin2hex(random_bytes(6));
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
            $outcome = CaseRules::failureOf(static fn (): string => Build::read($file));
            $case->compare('build', $outcome['result']);
            $case->compare('raises', $outcome['raises']);
            $case->compare('message', $outcome['raises']['message'] ?? null);
        } finally {
            if (is_file($file)) {
                unlink($file);
            }
            rmdir($directory);
        }
    }

    /** The outputs of a program in the order in which the open needs them; true for a directory. */
    private const OUTPUTS = [
        'reads.json' => false,
        'build.json' => false,
        'templates' => true,
        // HY-31.10: the copy of the reserved template, which the server reads while it renders by itself.
        'legacy/hyper/data.tpl' => false,
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
                if (!$isDirectory && !is_dir(dirname("{$program}/{$name}"))) {
                    mkdir(dirname("{$program}/{$name}"), 0o700, true);
                }
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
                // The directories that the step made for a file below the program directory.
                for ($parent = dirname($name); $parent !== '.'; $parent = dirname($parent)) {
                    rmdir("{$program}/{$parent}");
                }
            }
            rmdir($program);
            rmdir($directory);
        }
    }
}
