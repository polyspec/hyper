<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

/** The log of the server of HY-43.4, which a step collects while a request runs. */
final class ServerLog
{
    /**
     * Runs `$work` while `error_log` names a file of a temporary directory of the call, and returns its result with
     * the text that the server wrote to its log. The setting is restored and the directory removed.
     *
     * @template T
     *
     * @param \Closure(): T $work
     * @return array{0: T, 1: string}
     */
    public static function during(\Closure $work): array
    {
        $directory = sys_get_temp_dir() . '/hyper-log-' . bin2hex(random_bytes(6));
        mkdir($directory);
        $file = "{$directory}/error.log";
        $before = ini_set('error_log', $file);
        try {
            $result = $work();

            return [$result, is_file($file) ? (string) file_get_contents($file) : ''];
        } finally {
            ini_set('error_log', (string) $before);
            if (is_file($file)) {
                unlink($file);
            }
            rmdir($directory);
        }
    }

    /** Returns whether one text that the server gave to its log is exactly `$text`, after the time stamp of its line. */
    public static function holds(string $log, string $text): bool
    {
        return preg_match('/^\[[^\]\n]*\] ' . preg_quote($text, '/') . '$/m', $log) === 1;
    }

    /**
     * Returns the number of texts that the server gave to its log: the lines that hold `hyper: ` right after the time
     * stamp that PHP writes at the start of each `error_log` call.
     */
    public static function count(string $text): int
    {
        return (int) preg_match_all('/^\[[^\]\n]*\] hyper: /m', $text);
    }
}
