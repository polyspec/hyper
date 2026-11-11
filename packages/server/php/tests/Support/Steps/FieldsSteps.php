<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\Fields;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Tests\CaseReader;

/**
 * HY-56, HY-57, HY-113: the cases of contracts/fields.json. A urlencoded text is the UTF-8 encoding of its JSON string;
 * a multipart body is text whose characters are its bytes.
 */
final class FieldsSteps
{
    public static function urlencoded(CaseReader $case): void
    {
        $pairs = self::pairs(Fields::parse((string) $case->input('text')));
        $case->compare('fields', $pairs);
        $case->compare('names', $pairs === null ? null : array_column($pairs, 0));
    }

    public static function multipart(CaseReader $case): void
    {
        $type = (string) $case->input('type');
        $body = (string) $case->input('body');
        $fields = Fields::fromBody($type, (string) mb_convert_encoding($body, 'ISO-8859-1', 'UTF-8'));
        $case->compare('fields', self::pairs($fields));
        // The files are null when the fields are null, which is a name or a value that is not UTF-8.
        $case->compare('files', $fields === null ? null : self::files($type, $body));
    }

    /** @return ?list<array{0: string, 1: list<string>}> the name and values of each field, in order */
    private static function pairs(?Fields $fields): ?array
    {
        if ($fields === null) {
            return null;
        }
        $pairs = [];
        foreach ($fields as $name => $values) {
            $pairs[] = [(string) $name, $values];
        }

        return $pairs;
    }

    /** @return list<array{name: string, filename: string, contentType: string, content: string}> */
    private static function files(string $type, string $body): array
    {
        $request = new Request('POST', '/', ['Content-Type' => $type], '', $body);
        $files = [];
        foreach ($request->files() as $name => $parts) {
            foreach ($parts as $file) {
                $files[] = [
                    'name' => $file->name(),
                    'filename' => $file->filename(),
                    'contentType' => $file->contentType(),
                    'content' => $file->content(),
                ];
            }
        }

        return $files;
    }
}
