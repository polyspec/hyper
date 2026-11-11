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
    private function __construct(public readonly string $id)
    {
    }

    /**
     * Reads `build.json` of a server program. The file must exist, be valid JSON and hold exactly the key `build` with
     * a build id of 64 lowercase hexadecimal characters; a failure names the absolute path of the file (HY-125).
     *
     * @throws \InvalidArgumentException
     */
    public static function open(string $program): self
    {
        $file = "{$program}/build.json";
        $text = is_file($file) ? file_get_contents($file) : false;
        if ($text === false) {
            throw new \InvalidArgumentException("{$file} is missing or not readable (HY-125)");
        }
        try {
            $value = json_decode($text, true, flags: JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new \InvalidArgumentException("{$file} is not valid JSON (HY-125)");
        }
        if (
            !is_array($value)
            || array_keys($value) !== ['build']
            || !is_string($value['build'])
            || preg_match('/^[0-9a-f]{64}$/D', $value['build']) !== 1
        ) {
            throw new \InvalidArgumentException(
                "{$file} does not hold exactly the key build with a build id of 64 lowercase hexadecimal "
                . "characters (HY-125)",
            );
        }

        return new self($value['build']);
    }
}
