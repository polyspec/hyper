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
     * Reads the build id of a `build.json` file. The file must exist, and the core reads its bytes: valid JSON that
     * holds exactly the key `build` with a build id of 64 lowercase hexadecimal characters; a failure names the path
     * of the file (HY-125.19, HY-125.23).
     *
     * @throws HyperValueError of the kind `invalid_build` (HY-133.2)
     */
    public static function read(string $file): string
    {
        $text = is_file($file) ? file_get_contents($file) : false;
        if ($text === false) {
            throw new HyperValueError("{$file} is missing or not readable (HY-125)", 'invalid_build');
        }
        try {
            // Bytes that are not UTF-8, a leading U+FEFF and another form fail in the core (HY-106.7, HY-125.23).
            return CoreRules::shared()->buildRead($text);
        } catch (HyperValueError $error) {
            if ($error->kind() !== 'invalid_build') {
                throw $error;
            }
            $reason = $error->getMessage();
        }
        // The error of the core names no file; the error of the server names it (HY-125.23). The class of the
        // binding takes no previous error, so the reason of the core is its message.
        throw new HyperValueError("{$file}: {$reason}", 'invalid_build');
    }
}
