<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * Reads a `multipart/form-data` body without PHP's own reader, which needs `enable_post_data_reading` (HY-57): a part
 * with a `name` and no `filename` is a text field, and a part with a `name` and a `filename` is a file (HY-113). A part
 * without a name is neither.
 *
 * @internal
 */
final class Multipart
{
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
            $part = substr($body, $partStart + 2, $next - 2 - ($partStart + 2));
            $headerEnd = strpos($part, "\r\n\r\n");
            if ($headerEnd !== false) {
                $headers = substr($part, 0, $headerEnd);
                $content = substr($part, $headerEnd + 4);
                $disposition = preg_match('/^content-disposition:\s*form-data(.*)$/im', $headers, $found) === 1
                    ? rtrim($found[1], "\r")
                    : '';
                if (preg_match('/;\s*name="([^"]*)"/i', $disposition, $name) === 1) {
                    if (preg_match('/;\s*filename=(?:"((?:[^"\\\\]|\\\\.)*)"|([^;\s]*))/i', $disposition, $filename) !== 1) {
                        if (preg_match('//u', $name[1]) !== 1 || preg_match('//u', $content) !== 1) {
                            return null;
                        }
                        if (!array_key_exists($name[1], $values)) {
                            $names[] = $name[1];
                            $values[$name[1]] = [];
                        }
                        $values[$name[1]][] = $content;
                    } else {
                        // The quoted string keeps its escapes until here; a token is the text as it is (HY-113).
                        $quoted = str_contains($filename[0], '"');
                        $raw = $quoted ? $filename[1] : ($filename[2] ?? '');
                        $fileName = preg_replace('/\\\\(.)/s', '$1', $raw) ?? '';
                        $kind = preg_match('/^content-type:[ \t]*(.*?)\r?$/im', $headers, $type) === 1
                            ? trim($type[1])
                            : '';
                        if (
                            preg_match('//u', $name[1]) !== 1
                            || preg_match('//u', $fileName) !== 1
                            || preg_match('//u', $kind) !== 1
                        ) {
                            return null;
                        }
                        if (!array_key_exists($name[1], $files)) {
                            $fileNames[] = $name[1];
                            $files[$name[1]] = [];
                        }
                        $files[$name[1]][] = new UploadedFile($name[1], $fileName, $kind, $content);
                    }
                }
            }
            $start = $next;
        }

        return [new Fields($names, $values), new Files($fileNames, $files)];
    }
}
