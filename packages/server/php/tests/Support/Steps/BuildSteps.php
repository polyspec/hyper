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
            // A null `text` is a missing file, unless `bytes` gives the bytes of the file as hexadecimal digits.
            $text = $case->input('text');
            if (is_string($text)) {
                file_put_contents($file, $text);
            } elseif ($text !== null) {
                throw new \UnexpectedValueException('the case field text is neither a string nor null');
            } elseif ($case->has('bytes')) {
                $bytes = $case->input('bytes');
                $data = is_string($bytes) && preg_match('/^(?:[0-9a-f]{2})*$/D', $bytes) === 1 ? hex2bin($bytes) : false;
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
}
