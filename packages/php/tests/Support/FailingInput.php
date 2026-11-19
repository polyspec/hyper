<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

/**
 * A `php` stream wrapper whose stream opens and whose every read fails, as a read of a broken input does (HY-60.14).
 * The prototype of a stream wrapper of PHP fixes the names of its methods.
 */
final class FailingInput
{
    /** @var resource|null set by PHP for a stream wrapper */
    public $context;

    /** The bytes that the first read gives before the reads fail, so that a part with a file has started. */
    public static string $head = '';

    // phpcs:ignore PSR1.Methods.CamelCapsMethodName.NotCamelCaps -- PHP streamWrapper requires this name
    public function stream_open(string $path, string $mode, int $options, ?string &$opened): bool
    {
        return true;
    }

    // phpcs:ignore PSR1.Methods.CamelCapsMethodName.NotCamelCaps -- PHP streamWrapper requires this name
    public function stream_read(int $count): string|false
    {
        $head = self::$head;
        self::$head = '';

        return $head === '' ? false : $head;
    }

    // phpcs:ignore PSR1.Methods.CamelCapsMethodName.NotCamelCaps -- PHP streamWrapper requires this name
    public function stream_eof(): bool
    {
        return false;
    }

    // phpcs:ignore PSR1.Methods.CamelCapsMethodName.NotCamelCaps -- PHP streamWrapper requires this name
    public function stream_close(): void
    {
    }
}
