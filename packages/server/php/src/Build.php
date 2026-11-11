<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The build id of the application, which `build.json` of a server program holds as `{"build":"<id>"}` (HY-125). The
 * build id is the lowercase hexadecimal SHA-256 digest of the outputs of the browser; no server derives or defaults it.
 *
 * @internal
 */
final class Build
{
    /**
     * Reads the build id of a `build.json` file. The file must exist, be valid JSON and hold exactly the key `build`
     * with a build id of 64 lowercase hexadecimal characters; a failure names the path of the file (HY-125.5).
     *
     * @throws InvalidBuild
     */
    public static function read(string $file): string
    {
        $text = is_file($file) ? file_get_contents($file) : false;
        if ($text === false) {
            throw new InvalidBuild("{$file} is missing or not readable (HY-125)");
        }
        try {
            $value = json_decode($text, true, flags: JSON_THROW_ON_ERROR);
        } catch (\JsonException $error) {
            // Bytes that are not UTF-8 and a leading U+FEFF are not valid JSON, as in Node and Python (HY-106.7).
            throw new InvalidBuild("{$file} is not valid JSON (HY-125)", previous: $error);
        }
        if (
            !is_array($value)
            || array_keys($value) !== ['build']
            || !is_string($value['build'])
            || preg_match('/^[0-9a-f]{64}$/D', $value['build']) !== 1
        ) {
            throw new InvalidBuild(
                "{$file} does not hold exactly the key build with a build id of 64 lowercase hexadecimal "
                . "characters (HY-125)",
            );
        }

        return $value['build'];
    }
}
