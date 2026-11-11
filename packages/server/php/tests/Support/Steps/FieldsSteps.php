<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\Fields;
use Polyspec\Hyper\Files;
use Polyspec\Hyper\Multipart;
use Polyspec\Hyper\RequestBody;
use Polyspec\Hyper\UploadedFile;
use Polyspec\Hyper\Tests\CaseReader;

/**
 * HY-56, HY-57, HY-113: the cases of contracts/fields.json. A urlencoded text is the UTF-8 encoding of its JSON string,
 * and a multipart type and body are text whose characters are their bytes.
 */
final class FieldsSteps
{
    /** Parses the text and records its pairs and its names, or null for both when it fails with HY-42 (HY-56). */
    public static function urlencoded(CaseReader $case): void
    {
        $fields = Fields::parse(self::text($case, 'text'));
        $case->compare('fields', $fields?->pairs());
        $case->compare('names', $fields?->names());
    }

    /**
     * Reads the form values and the files of the body, or null for each when the body fails with HY-42 (HY-57,
     * HY-113).
     */
    public static function multipart(CaseReader $case): void
    {
        $type = self::bytes(self::text($case, 'type'));
        $body = self::bytes(self::text($case, 'body'));
        $whole = [self::fieldsOf(Fields::fromBody($type, $body)), self::filesOf(Files::fromBody($type, $body))];
        // HY-131.6: the body read in two chunks, divided at every position, gives the result of the whole body, and
        // the reader holds between two chunks at most its bound; the first division that differs is the result of
        // the case.
        $boundary = Multipart::boundary($type);
        $result = $whole;
        if ($boundary !== null) {
            $bound = max(8192 + 3, strlen($boundary) + 3);
            for ($at = 0; $at <= strlen($body) && $result === $whole; $at++) {
                $parts = new Multipart($boundary, null, null, null, null);
                foreach ([substr($body, 0, $at), substr($body, $at)] as $chunk) {
                    $parts->feed($chunk);
                    if ($parts->buffered() > $bound) {
                        throw new \UnexpectedValueException(
                            "the reader holds {$parts->buffered()} bytes after a chunk that ends at {$at};"
                            . " its bound is {$bound}",
                        );
                    }
                }
                $read = $parts->result();
                $divided = [self::fieldsOf($read[0] ?? null), self::filesOf($read[1] ?? null)];
                if ($divided !== $whole) {
                    $result = $divided;
                }
            }
        }
        $case->compare('fields', $result[0]);
        $case->compare('files', $result[1]);
    }

    /**
     * Reads the body in chunks as a host does, and records what the body holds, its parts, the files of its
     * directory, the move of its first file and the removal of the directory (HY-131).
     */
    public static function streamed(CaseReader $case): void
    {
        $type = self::text($case, 'type');
        $body = self::bytes(self::text($case, 'body'));
        $chunk = $case->input('chunk');
        $limit = $case->input('limit');
        $move = self::text($case, 'move');
        if (!is_int($chunk) || $chunk < 1 || !is_int($limit)) {
            throw new \UnexpectedValueException('the chunk or the limit of the case is not a number');
        }
        $valueLimit = $case->input('valueLimit');
        $partLimit = $case->input('partLimit');
        $fileLimit = $case->input('fileLimit');
        if (!is_int($valueLimit) || !is_int($partLimit) || !is_int($fileLimit)) {
            throw new \UnexpectedValueException('a limit of the case is not a number');
        }
        $read = new RequestBody($type, $limit, $case->input('stream') === true, $valueLimit, $partLimit, $fileLimit);
        $scratch = sys_get_temp_dir() . '/hyper-case-' . bin2hex(random_bytes(8));
        mkdir($scratch, 0700);
        try {
            $stopped = false;
            for ($at = 0; $at < strlen($body) && !$stopped; $at += $chunk) {
                $stopped = !$read->feed(substr($body, $at, $chunk));
            }
            $held = $read->held();
            $parts = $read->parts();
            if ($read->streamed()) {
                $fields = $parts[0] ?? null;
                $files = $parts[1] ?? null;
            } else {
                $fields = $stopped ? null : Fields::fromBody($type, $held);
                $files = $stopped ? null : Files::fromBody($type, $held);
            }
            $directory = $read->directory();
            $count = static fn (): ?int => $directory === null ? null : count(scandir($directory) ?: []) - 2;
            $case->compare('stopped', $stopped);
            $case->compare('exceeded', $read->exceeded());
            $case->compare('held', self::latin($held));
            $case->compare('fields', self::fieldsOf($fields));
            $entries = null;
            if ($files !== null) {
                $entries = [];
                foreach ($files->pairs() as [, $list]) {
                    foreach ($list as $file) {
                        $entries[] = [
                            'name' => $file->name(),
                            'filename' => $file->filename(),
                            'contentType' => $file->contentType(),
                            'content' => self::latin($file->content()),
                            'size' => $file->size(),
                        ];
                    }
                }
            }
            $case->compare('files', $entries);
            $case->compare('entries', $count());
            $first = $files?->pairs()[0][1][0] ?? null;
            if ($move === 'none' || $first === null) {
                $case->compare('moved', null);
            } else {
                $target = "{$scratch}/target";
                if ($move === 'exists') {
                    file_put_contents($target, 'taken');
                }
                $failed = self::failure(static fn () => $first->moveTo($move === 'type' ? 7 : $target));
                $after = null;
                if ($failed === null) {
                    $content = self::latin((string) file_get_contents($target));
                    $failed = self::failure(static fn () => $first->moveTo("{$scratch}/second"));
                    $after = self::failure(static fn () => $first->content())[0] ?? null;
                } else {
                    $content = self::latin($first->content());
                }
                $case->compare('moved', [
                    'content' => $content,
                    'left' => $count(),
                    'again' => $failed[0] ?? null,
                    'read' => $after,
                    'class' => $failed[1] ?? null,
                ]);
            }
            $read->remove();
            $case->compare('removed', $directory === null ? null : !is_dir($directory));
        } finally {
            $read->remove();
            foreach (scandir($scratch) ?: [] as $entry) {
                if ($entry !== '.' && $entry !== '..') {
                    unlink("{$scratch}/{$entry}");
                }
            }
            rmdir($scratch);
        }
    }

    /**
     * Runs the work and returns the message and the class of its failure, `type` for a TypeError and `value` for the
     * class of HY-46.2, or null when it does not fail.
     *
     * @param callable(): mixed $work
     *
     * @return array{string, string}|null
     */
    private static function failure(callable $work): ?array
    {
        try {
            $work();

            return null;
        } catch (\TypeError $error) {
            return [$error->getMessage(), 'type'];
        } catch (\InvalidArgumentException $error) {
            return [$error->getMessage(), 'value'];
        }
    }

    /** Returns the text whose characters are the bytes. */
    private static function latin(string $bytes): string
    {
        return (string) mb_convert_encoding($bytes, 'UTF-8', 'ISO-8859-1');
    }

    /** @return list<array{string, list<string>}>|null */
    private static function fieldsOf(?Fields $fields): ?array
    {
        return $fields?->pairs();
    }

    /** @return list<array<string, string>>|null */
    private static function filesOf(?Files $files): ?array
    {
        if ($files === null) {
            return null;
        }
        $entries = [];
        foreach ($files->pairs() as [, $list]) {
            foreach ($list as $file) {
                $entries[] = [
                    'name' => $file->name(),
                    'filename' => $file->filename(),
                    'contentType' => $file->contentType(),
                    'content' => (string) mb_convert_encoding($file->content(), 'UTF-8', 'ISO-8859-1'),
                ];
            }
        }

        return $entries;
    }

    private static function text(CaseReader $case, string $name): string
    {
        $value = $case->input($name);

        return is_string($value)
            ? $value
            : throw new \UnexpectedValueException("the case field {$name} is not a string");
    }

    /** Returns the bytes of text whose characters are bytes. */
    private static function bytes(string $text): string
    {
        return (string) mb_convert_encoding($text, 'ISO-8859-1', 'UTF-8');
    }
}
