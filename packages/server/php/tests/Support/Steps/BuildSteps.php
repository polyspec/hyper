<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\Build;
use Polyspec\Hyper\InvalidBuild;
use Polyspec\Hyper\Tests\CaseReader;

/** HY-125: the cases of contracts/build.json, the build id that a `build.json` file gives. */
final class BuildSteps
{
    public static function read(CaseReader $case): void
    {
        $directory = sys_get_temp_dir() . '/hyper-build-' . bin2hex(random_bytes(6));
        mkdir($directory);
        $file = "{$directory}/build.json";
        try {
            $text = $case->input('text');
            if (is_string($text)) {
                file_put_contents($file, $text);
            }
            try {
                $build = Build::read($file);
                $error = null;
            } catch (InvalidBuild $failure) {
                $build = null;
                $error = str_contains($failure->getMessage(), $file) ? 'invalid-build' : $failure->getMessage();
            }
            $case->compare('build', $build);
            $case->compare('error', $error);
        } finally {
            if (is_file($file)) {
                unlink($file);
            }
            rmdir($directory);
        }
    }
}
