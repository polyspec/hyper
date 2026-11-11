<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The file parts of a multipart body: each name, in the order of its first occurrence, with its files in request order
 * (HY-113).
 *
 * @extends NamedValues<UploadedFile>
 *
 * @internal
 */
final class Files extends NamedValues
{
    /** Returns files without names. */
    public static function empty(): self
    {
        return new self([], []);
    }

    /**
     * Returns the files of a `multipart/form-data` body, and none for another body type. Returns null when a part of
     * the body fails with HY-42 (HY-113.15).
     */
    public static function fromBody(string $type, string $body): ?self
    {
        $boundary = Multipart::boundary($type);
        if ($boundary === null) {
            return self::empty();
        }

        return Multipart::read($body, $boundary)[1] ?? null;
    }

    /** Returns the size in bytes of the largest file, or 0 when there is none (HY-114). */
    public function largest(): int
    {
        $sizes = [0];
        foreach ($this->pairs() as [, $files]) {
            foreach ($files as $file) {
                $sizes[] = strlen($file->content());
            }
        }

        return max($sizes);
    }
}
