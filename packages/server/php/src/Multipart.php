<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * Reads a `multipart/form-data` body without PHP's own reader, which needs `enable_post_data_reading` (HY-57): a part
 * whose `Content-Disposition` is `form-data` with a `name` and no `filename` is a text field, a part with a `name` and
 * a `filename` is a file, and a part without a name is neither (HY-113). The header lines of a part are separated by
 * CRLF, and blanks are spaces and tabs (HY-113.12, HY-113.13).
 *
 * @internal
 */
final class Multipart
{
    private const NAME = '/;[ \t]*name="([^"]*)"/i';

    private const FILENAME = '/;[ \t]*filename=(?:"([^"]*)"|([^; \t]*))/i';

    /** The largest header of a part in bytes (HY-113.16). */
    private const HEADER_LIMIT = 8192;

    /** Returns the boundary of a `multipart/form-data` content type, or null for another type (HY-57, HY-113). */
    public static function boundary(string $type): ?string
    {
        if (
            preg_match('#^multipart/form-data[ \t]*;#i', $type) !== 1
            || preg_match('#;[ \t]*boundary=(?:"([^"]+)"|([^; \t]+))#i', $type, $found, PREG_UNMATCHED_AS_NULL) !== 1
        ) {
            return null;
        }

        return $found[1] ?? $found[2];
    }

    /**
     * Returns the text fields and the files of the body, or null when a name, a value, a filename or a content type is
     * not UTF-8 (HY-42, HY-113).
     *
     * @return array{0: Fields, 1: Files}|null
     */
    public static function read(string $body, string $boundary): ?array
    {
        $delimiter = "--{$boundary}";
        $names = [];
        $values = [];
        $fileNames = [];
        $files = [];
        $start = strpos($body, $delimiter);
        while ($start !== false) {
            $partStart = $start + strlen($delimiter);
            if (substr($body, $partStart, 2) === '--') {
                break;
            }
            $next = strpos($body, $delimiter, $partStart);
            if ($next === false) {
                break;
            }
            // Fewer than four bytes between two delimiters hold no part; a negative length of substr counts from the
            // end of the body.
            $part = $next - 2 < $partStart + 2 ? '' : substr($body, $partStart + 2, $next - 2 - ($partStart + 2));
            $headerEnd = strpos($part, "\r\n\r\n");
            $start = $next;
            if (($headerEnd === false ? strlen($part) : $headerEnd) > self::HEADER_LIMIT) {
                return null;
            }
            if ($headerEnd === false) {
                continue;
            }
            $lines = explode("\r\n", substr($part, 0, $headerEnd));
            $content = substr($part, $headerEnd + 4);
            $disposition = self::headerValue($lines, 'content-disposition');
            if ($disposition === null || strtolower(substr($disposition, 0, 9)) !== 'form-data') {
                continue;
            }
            $parameters = substr($disposition, 9);
            $named = preg_match(self::NAME, $parameters, $found);
            $filed = preg_match(self::FILENAME, $parameters, $filename, PREG_UNMATCHED_AS_NULL);
            if ($named === false || $filed === false) {
                // A pattern that fails is a defect of this reader, not a part without the parameter.
                throw new \LogicException('hyper: ' . preg_last_error_msg());
            }
            if ($named !== 1) {
                continue;
            }
            $name = self::utf8Text($found[1]);
            if ($name === null) {
                return null;
            }
            if ($filed !== 1) {
                $value = self::utf8Text($content);
                if ($value === null) {
                    return null;
                }
                self::addValue($names, $values, $name, $value);
            } else {
                // A quoted filename keeps its backslashes; a token is the text as it is (HY-113.14).
                $raw = $filename[1] ?? $filename[2] ?? '';
                $text = self::utf8Text($raw);
                $kind = self::utf8Text(self::headerValue($lines, 'content-type') ?? '');
                if ($text === null || $kind === null) {
                    return null;
                }
                self::addValue($fileNames, $files, $name, new UploadedFile($name, $text, $kind, $content));
            }
        }

        return [new Fields($names, $values), new Files($fileNames, $files)];
    }

    /**
     * Returns the value of the first header line of the name, compared without case, without the spaces and tabs
     * around it, or null when no line has the name.
     *
     * @param list<string> $lines
     */
    private static function headerValue(array $lines, string $name): ?string
    {
        foreach ($lines as $line) {
            $colon = strpos($line, ':');
            if ($colon !== false && strtolower(substr($line, 0, $colon)) === $name) {
                return trim(substr($line, $colon + 1), " \t");
            }
        }

        return null;
    }

    /**
     * Appends a value to its name, and the name to the names at its first value.
     *
     * @template T
     *
     * @param list<string> $names
     * @param array<array-key, list<T>> $values
     * @param T $value
     */
    private static function addValue(array &$names, array &$values, string $name, mixed $value): void
    {
        if (!array_key_exists($name, $values)) {
            $names[] = $name;
            $values[$name] = [];
        }
        $values[$name][] = $value;
    }

    /** Returns the bytes when they are UTF-8, or null. */
    private static function utf8Text(string $bytes): ?string
    {
        return preg_match('//u', $bytes) === 1 ? $bytes : null;
    }
}
