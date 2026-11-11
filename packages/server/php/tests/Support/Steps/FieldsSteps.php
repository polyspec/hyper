<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\Fields;
use Polyspec\Hyper\Files;
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
        $case->compare('fields', Fields::fromBody($type, $body)?->pairs());
        $files = Files::fromBody($type, $body);
        if ($files === null) {
            $case->compare('files', null);

            return;
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
        $case->compare('files', $entries);
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
