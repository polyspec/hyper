<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\Manifest;
use Polyspec\Hyper\Region;
use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\Json;
use Polyspec\Hyper\Tests\Support\Plain;

/** HY-2, HY-37: the cases of contracts/manifest.json, the manifest file that the manifest check reads or rejects. */
final class ManifestSteps
{
    /** Records the error of the read of the manifest file of the case, or null. */
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
        $failure = null;
        try {
            self::read($bytes);
        } catch (\Throwable $error) {
            $failure = $error;
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
            $region = $manifest->region($name) ?? throw new \UnexpectedValueException("the manifest has no region {$name}");
            $case->compare('keep', Plain::map($region->keep));
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
