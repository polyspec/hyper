<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;

/** The classes of the package that carry no `@internal` tag are the public API that HY-106 names. */
final class PublicApiTest extends TestCase
{
    public function testTheClassesWithoutTheInternalTagAreThePublicApi(): void
    {
        $public = [];
        foreach (glob(__DIR__ . '/../src/*.php') ?: [] as $file) {
            $name = 'Polyspec\\Hyper\\' . basename($file, '.php');
            if (!class_exists($name) && !interface_exists($name)) {
                self::fail("{$file} declares no autoloadable class or interface {$name}");
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
        ], $public);
    }
}
