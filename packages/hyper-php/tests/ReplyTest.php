<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Reply;

/** HY-52: a page carries the session token of its visitor, so no shared cache may store it. */
final class ReplyTest extends TestCase
{
    public function testAcceptsACacheControlThatKeepsThePagePrivate(): void
    {
        foreach (['private, max-age=60', 'no-store', 'Private', 'max-age=0, private', 'no-cache, no-store'] as $value) {
            self::assertSame($value, (new Reply())->cacheControl($value)->cacheControlValue(), $value);
        }
    }

    public function testRefusesACacheControlThatAllowsASharedCache(): void
    {
        foreach (['public, max-age=60', 'max-age=60', 'no-cache', 'private, s-maxage=60', 'private, public', 'PUBLIC, private', 'privateer', ''] as $value) {
            try {
                (new Reply())->cacheControl($value);
                self::fail("{$value} is accepted");
            } catch (\InvalidArgumentException $error) {
                self::assertStringContainsString('Cache-Control', $error->getMessage(), $value);
            }
        }
    }
}
