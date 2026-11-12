<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * Turns a warning, notice or deprecation that is raised while a request is answered into an error (HY-74).
 *
 * @internal
 */
final class WarningsGuard
{
    /**
     * Runs `$work` with every warning, notice and deprecation as an \ErrorException and restores the previous error
     * handler when it ends; an error that `@` silences is not in error_reporting() and stays silent.
     *
     * @template T
     *
     * @param callable(): T $work
     *
     * @return T
     */
    public static function run(callable $work): mixed
    {
        set_error_handler(static function (int $level, string $message, string $file, int $line): bool {
            if ((error_reporting() & $level) === 0) {
                return false;
            }

            throw new \ErrorException($message, 0, $level, $file, $line);
        });
        try {
            return $work();
        } finally {
            restore_error_handler();
        }
    }
}
