<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\CoreStandIn;

/**
 * A stand-in of the functions of the binding of the core (CoreRulesTest): each function records its call in
 * `Calls::$calls` and returns `Calls::$results[<name>]`, or throws it when it is a Throwable.
 */
final class Calls
{
    /** @var list<array{string, list<mixed>}> */
    public static array $calls = [];

    /** @var array<string, mixed> */
    public static array $results = [];

    /** @param list<mixed> $arguments */
    public static function record(string $name, array $arguments): mixed
    {
        self::$calls[] = [$name, $arguments];
        $result = self::$results[$name] ?? null;
        if ($result instanceof \Throwable) {
            throw $result;
        }

        return $result;
    }
}

function csrfMask(mixed ...$arguments): mixed
{
    return Calls::record('csrfMask', array_values($arguments));
}

function csrfVerify(mixed ...$arguments): mixed
{
    return Calls::record('csrfVerify', array_values($arguments));
}

function browser(mixed ...$arguments): mixed
{
    return Calls::record('browser', array_values($arguments));
}

function storedToken(mixed ...$arguments): mixed
{
    return Calls::record('storedToken', array_values($arguments));
}

function isApplicationPath(mixed ...$arguments): mixed
{
    return Calls::record('isApplicationPath', array_values($arguments));
}

function redirectLocation(mixed ...$arguments): mixed
{
    return Calls::record('redirectLocation', array_values($arguments));
}

function cacheControl(mixed ...$arguments): mixed
{
    return Calls::record('cacheControl', array_values($arguments));
}

function keepsOutOfSharedCaches(mixed ...$arguments): mixed
{
    return Calls::record('keepsOutOfSharedCaches', array_values($arguments));
}

function referrerPolicy(mixed ...$arguments): mixed
{
    return Calls::record('referrerPolicy', array_values($arguments));
}

function sessionName(mixed ...$arguments): mixed
{
    return Calls::record('sessionName', array_values($arguments));
}

function keepName(mixed ...$arguments): mixed
{
    return Calls::record('keepName', array_values($arguments));
}

function sessionCookie(mixed ...$arguments): mixed
{
    return Calls::record('sessionCookie', array_values($arguments));
}

function pageTag(mixed ...$arguments): mixed
{
    return Calls::record('pageTag', array_values($arguments));
}

function representationTag(mixed ...$arguments): mixed
{
    return Calls::record('representationTag', array_values($arguments));
}

function pageStatus(mixed ...$arguments): mixed
{
    return Calls::record('pageStatus', array_values($arguments));
}

function replyStatus(mixed ...$arguments): mixed
{
    return Calls::record('replyStatus', array_values($arguments));
}

function pageVary(mixed ...$arguments): mixed
{
    return Calls::record('pageVary', array_values($arguments));
}

function contextHash(mixed ...$arguments): mixed
{
    return Calls::record('contextHash', array_values($arguments));
}

function currentPath(mixed ...$arguments): mixed
{
    return Calls::record('currentPath', array_values($arguments));
}

function checkShellPath(mixed ...$arguments): mixed
{
    return Calls::record('checkShellPath', array_values($arguments));
}

function shellText(mixed ...$arguments): mixed
{
    return Calls::record('shellText', array_values($arguments));
}

function checkBuildId(mixed ...$arguments): mixed
{
    return Calls::record('checkBuildId', array_values($arguments));
}

function readBuild(mixed ...$arguments): mixed
{
    return Calls::record('readBuild', array_values($arguments));
}

function frameHeaders(mixed ...$arguments): mixed
{
    return Calls::record('frameHeaders', array_values($arguments));
}

function keptValue(mixed ...$arguments): mixed
{
    return Calls::record('keptValue', array_values($arguments));
}

function validContextHeader(mixed ...$arguments): mixed
{
    return Calls::record('validContextHeader', array_values($arguments));
}
