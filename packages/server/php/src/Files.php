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
        if (
            preg_match('#^multipart/form-data\s*;#i', $type) === 1
            && preg_match('#;\s*boundary=(?:"([^"]+)"|([^;\s]+))#i', $type, $found) === 1
        ) {
            $parts = Multipart::read($body, $found[1] !== '' ? $found[1] : $found[2]);

            return $parts === null ? null : $parts[1];
        }

        return self::empty();
    }

    /**
     * Returns the names in the order of their first occurrence.
     *
     * @return list<string>
     */
    public function names(): array
    {
        return $this->names;
    }

    /**
     * Returns the files of a name in request order; an absent name has none.
     *
     * @return list<UploadedFile>
     */
    public function get(string $name): array
    {
        return $this->values[$name] ?? [];
    }

    /** Returns the last file of a name, or null. */
    public function last(string $name): ?UploadedFile
    {
        $files = $this->get($name);

        return $files === [] ? null : $files[count($files) - 1];
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
