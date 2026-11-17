<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\BodyReader;
use Polyspec\Hyper\Fields;
use Polyspec\Hyper\Files;
use Polyspec\Hyper\UploadedFile;
use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\CaseInput;
use Polyspec\Hyper\Tests\Support\CaseRules;

/**
 * HY-56, HY-57, HY-113, HY-131: the cases of `fields.json` and `forms.json` of the http-form release that
 * config/release-files.json pins (H35.11), in the case form of binding: a text and a body are `{"hex": …}`, the limits
 * are the record `limits`, and a failure is `raises`. Each step reads through the code of the server, which calls the
 * core.
 */
final class FieldsSteps
{
    /** Parses the text and records its pairs and its names, or the failure of the text (HY-56). */
    public static function urlencoded(CaseReader $case): void
    {
        $outcome = CaseRules::failureOf(static fn (): Fields => Fields::read(self::hex($case, 'text')));
        $fields = $outcome['result'];
        $case->compare('fields', $fields?->pairs());
        $case->compare('names', $fields?->names());
        $case->compare('raises', $outcome['raises']);
    }

    /** Reads the form values and the files of a body held as one value, or the failure of the body (HY-57, HY-113). */
    public static function multipart(CaseReader $case): void
    {
        $type = CaseInput::text($case, 'content_type');
        $body = self::hex($case, 'body');
        $outcome = CaseRules::failureOf(static fn (): array => Files::readHeld($type, $body));
        $parts = $outcome['result'];
        $case->compare('fields', $parts === null ? null : $parts[0]->pairs());
        $case->compare('files', $parts === null ? null : self::filesOf($parts[1]));
        $case->compare('raises', $outcome['raises']);
    }

    /**
     * Reads the body in chunks as a host does, and records what the body holds, its parts, the files of its
     * directory, the move of its first file and the removal of the directory (HY-131).
     */
    public static function streamed(CaseReader $case): void
    {
        $type = CaseInput::text($case, 'content_type');
        $body = self::hex($case, 'body');
        $chunk = $case->input('chunk');
        $move = CaseInput::text($case, 'move');
        $limits = $case->input('limits');
        $limit = static fn (string $name): int => is_array($limits) && is_int($limits[$name] ?? null)
            ? $limits[$name]
            : throw new \UnexpectedValueException("the limit {$name} of the case is not a number");
        if (!is_int($chunk) || $chunk < 1) {
            throw new \UnexpectedValueException('the chunk of the case is not a number');
        }
        $read = new BodyReader(
            $type,
            $limit('limit'),
            $case->input('stream') === true,
            $limit('value_limit'),
            $limit('part_limit'),
            $limit('file_limit'),
        );
        $scratch = sys_get_temp_dir() . '/hyper-case-' . bin2hex(random_bytes(8));
        mkdir($scratch, 0700);
        try {
            $stopped = false;
            for ($at = 0; $at < strlen($body) && !$stopped; $at += $chunk) {
                $stopped = !$read->feed(substr($body, $at, $chunk));
            }
            $read->finish();
            $held = $read->held();
            $outcome = CaseRules::failureOf(
                static fn (): array => $read->streamed() ? $read->read() : self::heldParts($read, $type, $held),
            );
            $parts = $outcome['result'];
            $files = $parts[1] ?? null;
            $directory = $read->directory();
            $count = static fn (): ?int => $directory === null ? null : count(scandir($directory) ?: []) - 2;
            $case->compare('stopped', $stopped);
            $case->compare('exceeded', $read->exceeded());
            $case->compare('held', self::latin($held));
            $case->compare('fields', $parts === null ? null : $parts[0]->pairs());
            $case->compare('files', $files === null ? null : self::filesOf($files, true));
            $case->compare('raises', $outcome['raises']);
            $case->compare('entries', $count());
            $first = $files?->pairs()[0][1][0] ?? null;
            if ($move === 'none' || $first === null) {
                $case->compare('moved', null);
            } else {
                $target = "{$scratch}/target";
                if ($move === 'exists') {
                    file_put_contents($target, 'taken');
                }
                $failed = self::failure(static fn () => self::moveFile($first, $move === 'type' ? 7 : $target));
                $after = null;
                if ($failed === null) {
                    $content = self::latin((string) file_get_contents($target));
                    $failed = self::failure(static fn () => self::moveFile($first, "{$scratch}/second"));
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
     * The parts of a body that is held as one value: none after the body failed, else the form of its bytes.
     *
     * @return array{0: Fields, 1: Files}
     */
    private static function heldParts(BodyReader $read, string $type, string $held): array
    {
        $failure = $read->failure();
        if ($failure !== null) {
            throw $failure;
        }

        return Files::readHeld($type, $held);
    }

    /** Moves an uploaded file to the target, which a case also gives as a value of another type (HY-131). */
    private static function moveFile(UploadedFile $file, mixed $target): void
    {
        $file->moveTo($target);
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

    /** Returns the bytes of a field `{"hex": …}` of the case. */
    private static function hex(CaseReader $case, string $name): string
    {
        $value = $case->input($name);
        $digits = is_array($value) ? ($value['hex'] ?? null) : (is_object($value) ? ($value->hex ?? null) : null);
        if (!is_string($digits) || ($bytes = hex2bin($digits)) === false) {
            throw new \UnexpectedValueException("the field {$name} of the case is no {\"hex\": …} value");
        }

        return $bytes;
    }

    /** Returns the text whose characters are the bytes. */
    private static function latin(string $bytes): string
    {
        return (string) mb_convert_encoding($bytes, 'UTF-8', 'ISO-8859-1');
    }

    /**
     * Returns the files in request order as the cases state them, with the size of each when `$sizes` is true.
     *
     * @return list<array<string, string|int>>
     */
    private static function filesOf(Files $files, bool $sizes = false): array
    {
        $entries = [];
        foreach ($files->pairs() as [, $list]) {
            foreach ($list as $file) {
                $entry = [
                    'name' => $file->name(),
                    'filename' => $file->filename(),
                    'contentType' => $file->contentType(),
                    'content' => self::latin($file->content()),
                ];
                $entries[] = $sizes ? [...$entry, 'size' => $file->size()] : $entry;
            }
        }

        return $entries;
    }
}
