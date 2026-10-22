<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The file parts of a multipart body: an ordered map from each name, in the order of its first occurrence, to its
 * files in request order (HY-113).
 *
 * @internal
 */
final class Files
{
    /** @use NamedValues<UploadedFile> */
    use NamedValues;

    /**
     * @param list<string> $names
     * @param array<array-key, list<UploadedFile>> $values files by name
     */
    public function __construct(
        private readonly array $names,
        private readonly array $values,
    ) {
    }

    /** Returns files without names. */
    public static function empty(): self
    {
        return new self([], []);
    }

    /**
     * Returns the files of a `multipart/form-data` body, and none for another body type. Returns null when a name, a
     * filename or a content type is not UTF-8 (HY-42, HY-113).
     */
    public static function fromBody(string $type, string $body): ?self
    {
        $boundary = Multipart::boundary($type);
        if ($boundary !== null) {
            $parts = Multipart::read($body, $boundary);

            return $parts === null ? null : $parts[1];
        }

        return self::empty();
    }

    /** Returns the last file of a name, or null. */
    public function last(string $name): ?UploadedFile
    {
        return $this->lastOf($name);
    }

    /** Returns the size in bytes of the largest file, or 0 when there is none (HY-114). */
    public function largest(): int
    {
        $sizes = [0];
        foreach ($this->values as $files) {
            foreach ($files as $file) {
                $sizes[] = strlen($file->content());
            }
        }

        return max($sizes);
    }
}
