<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;

/** HY-106, HY-113: declarations without an `@internal` tag are public, including UploadedFile. */
final class PublicApiTest extends TestCase
{
    public function testTheClassesWithoutTheInternalTagAreThePublicApi(): void
    {
        $public = [];
        foreach (glob(__DIR__ . '/../src/*.php') ?: [] as $file) {
            $name = 'Polyspec\\Hyper\\' . basename($file, '.php');
            if (!class_exists($name) && !interface_exists($name) && !trait_exists($name)) {
                self::fail("{$file} declares no autoloadable class, interface or trait {$name}");
            }
            $class = new \ReflectionClass($name);
            if (!str_contains((string) $class->getDocComment(), '@internal')) {
                $public[] = $class->getShortName();
            }
        }
        sort($public);
        self::assertSame([
            'App',
            'ArraySession',
            'BadRequest',
            'Choice',
            'ClientRendering',
            'Container',
            'Forbidden',
            'NativeSession',
            'NotFound',
            'Redirect',
            'Reply',
            'Request',
            'Response',
            'Result',
            'SessionStore',
            'UploadedFile',
        ], $public);
    }
}
