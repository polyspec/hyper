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
     * Reads the build id of a `build.json` file. The file must exist, and the core reads its bytes: valid JSON that holds
     * exactly the key `build` with a build id of 64 lowercase hexadecimal characters; a failure names the path of the
     * file (HY-125.5, HY-125.18).
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
            // Bytes that are not UTF-8, a leading U+FEFF and another form fail in the core (HY-106.7, HY-125.18).
            return CoreRules::shared()->buildRead($text);
        } catch (HyperValueError $error) {
            if ($error->kind() !== 'invalid_build') {
                throw $error;
            }

            throw new InvalidBuild("{$file}: {$error->getMessage()}", previous: $error);
        }
    }
}
