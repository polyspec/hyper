<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * Opens the pages of the core from the server program that `hyper build` of `@polyspec/hyper-cli` wrote to a
 * directory (HY-48.21): the bytes of the manifest, the sources of `templates`, the read paths of `reads.json` (HY-73)
 * and the build id of `build.json` (HY-125). The core renders the templates (HY-12, HY-13, HY-31) and holds the
 * reserved template of the embedded data (HY-31.9).
 *
 * @internal
 */
final class Program
{
    /**
     * @param list<string> $formTypes
     * @param array<string, mixed> $functions the host functions of the application (HYC-24)
     */
    public static function pages(
        string $manifest,
        string $program,
        string $timezone,
        bool $context,
        string $basePath,
        array $formTypes,
        ?string $dataBasePath,
        array $functions,
    ): Pages {
        // HY-48.21: a missing build fails here and names the first missing output, in this order.
        $required = [
            "{$program}/reads.json" => is_file(...),
            "{$program}/build.json" => is_file(...),
            "{$program}/templates" => is_dir(...),
        ];
        foreach ($required as $path => $exists) {
            if (!$exists($path)) {
                throw new HyperValueError(
                    "{$path} of the server program {$program} is missing; "
                    . 'hyper build of @polyspec/hyper-cli builds it',
                    // HY-106.21: only a missing build file has the kind invalid_build.
                    $path === "{$program}/build.json" ? 'invalid_build' : 'invalid_application',
                );
            }
        }
        // HYC-24.5, HYC-24.7: the core fails an entry that is not a function.
        foreach ($functions as $name => $function) {
            CoreRules::shared()->checkFunctionEntry((string) $name, is_callable($function));
        }
        $pages = new Pages(
            (string) file_get_contents($manifest),
            self::templates("{$program}/templates"),
            self::reads("{$program}/reads.json"),
            Build::read("{$program}/build.json"),
            $timezone,
            $context,
            $basePath,
            $formTypes,
            $dataBasePath,
        );
        // HYC-24.9: a name that the template language refuses fails the open with the message of the core.
        foreach ($functions as $name => $function) {
            /** @var callable $function */
            $pages->register((string) $name, \Closure::fromCallable($function));
        }

        return $pages;
    }

    /**
     * Returns the routes of `reads.json`, with JSON objects as `stdClass`, so that an empty object stays a map.
     */
    private static function reads(string $file): mixed
    {
        $reads = json_decode((string) file_get_contents($file), false);
        // HY-106.21: a reads file that is not JSON fails the open.
        if (json_last_error() !== JSON_ERROR_NONE) {
            throw new HyperValueError("{$file} is not valid JSON or UTF-8", 'invalid_application');
        }
        if (!$reads instanceof \stdClass || !($reads->routes ?? null) instanceof \stdClass) {
            throw new HyperValueError("{$file} has no routes", 'invalid_application');
        }

        return $reads->routes;
    }

    /**
     * Returns the sources of the templates by their names relative to the directory, with `/` between the segments, in
     * the byte order of the names. A file that is not UTF-8 fails the open (HY-106.21).
     *
     * @return array<string, string>
     */
    private static function templates(string $directory): array
    {
        $names = [];
        $files = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($directory, \FilesystemIterator::SKIP_DOTS),
        );
        foreach ($files as $file) {
            if ($file instanceof \SplFileInfo && $file->isFile()) {
                $names[] = str_replace('\\', '/', substr($file->getPathname(), strlen($directory) + 1));
            }
        }
        sort($names, SORT_STRING);
        $sources = [];
        foreach ($names as $name) {
            $path = "{$directory}/{$name}";
            $source = (string) file_get_contents($path);
            if (preg_match('//u', $source) !== 1) {
                throw new HyperValueError("{$path} is not valid UTF-8", 'invalid_application');
            }
            $sources[$name] = $source;
        }

        return $sources;
    }
}
