<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server\Tests\Support\Steps;

use Polyspec\Hyper\Server\App;
use Polyspec\Hyper\Server\Manifest;
use Polyspec\Hyper\Server\Region;
use Polyspec\Hyper\Server\Tests\CaseReader;
use Polyspec\Hyper\Server\Tests\Support\Json;
use Polyspec\Hyper\Server\Tests\Support\Plain;

/** HY-2, HY-37: the cases of contracts/manifest.json, the manifest file that the manifest check reads or rejects. */
final class ManifestSteps
{
    /** Records the error with which the open of an application refuses the manifest file of the case, or null. */
    public static function checks(CaseReader $case): void
    {
        $stated = array_values(array_filter(['manifest', 'text', 'bytes'], $case->has(...)));
        if (count($stated) !== 1) {
            throw new \UnexpectedValueException('the case states not exactly one of manifest, text and bytes');
        }
        $value = $case->input($stated[0]);
        if ($stated[0] === 'manifest') {
            $bytes = self::encoded($value);
        } elseif ($stated[0] === 'text') {
            $bytes = Json::string($value);
        } else {
            $bytes = is_string($value) && preg_match('/^(?:[0-9a-f]{2})*$/D', $value) === 1 ? hex2bin($value) : false;
            if ($bytes === false) {
                throw new \UnexpectedValueException('the case field bytes is not hexadecimal digits');
            }
        }
        $directory = sys_get_temp_dir() . '/hyper-manifest-' . bin2hex(random_bytes(6));
        mkdir($directory);
        $file = "{$directory}/manifest.json";
        // The program does not exist: an open that fails only for it has read the manifest (HY-2.7).
        $program = "{$directory}/absent";
        $failure = null;
        try {
            file_put_contents($file, $bytes);
            App::open(manifest: $file, program: $program, handlers: [], timezone: 'Z');

            throw new \LogicException('the application opened without a program');
        } catch (\InvalidArgumentException $error) {
            $failure = str_starts_with($error->getMessage(), "{$program}/php of the server program") ? null : $error;
        } finally {
            if (is_file($file)) {
                unlink($file);
            }
            rmdir($directory);
        }
        $case->compare('rejected', $failure);
    }

    /** Records the regions, the page region, the routes and the kept paths of a region of the manifest of the case. */
    public static function reads(CaseReader $case): void
    {
        $manifest = self::read(self::encoded($case->input('manifest')));
        $case->compare('regions', array_map(static fn (Region $region): string => $region->name, $manifest->regions));
        $case->compare('page', $manifest->page->name);
        $case->compare('routes', array_map(strval(...), array_keys($manifest->routes)));
        if ($case->has('region')) {
            $name = Json::string($case->input('region'));
            $region = $manifest->region($name)
                ?? throw new \UnexpectedValueException("the manifest has no region {$name}");
            $case->compare('keep', Plain::map($region->keep));
            if ($case->has('template')) {
                $case->compare('template', $region->template);
            }
            if ($case->has('kinds')) {
                $case->compare('keptPaths', $region->keptPaths(Json::strings($case->input('kinds'))));
            }
        }
    }

    private static function encoded(mixed $manifest): string
    {
        return json_encode($manifest, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /** Reads the bytes as the file `manifest.json` of a temporary directory of the call, which it removes. */
    private static function read(string $bytes): Manifest
    {
        $directory = sys_get_temp_dir() . '/hyper-manifest-' . bin2hex(random_bytes(6));
        mkdir($directory);
        $file = "{$directory}/manifest.json";
        try {
            file_put_contents($file, $bytes);

            return Manifest::fromFile($file);
        } finally {
            if (is_file($file)) {
                unlink($file);
            }
            rmdir($directory);
        }
    }
}
