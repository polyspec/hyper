<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\Fields;
use Polyspec\Hyper\Files;
use Polyspec\Hyper\Multipart;
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
                $parts = new Multipart($boundary);
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
