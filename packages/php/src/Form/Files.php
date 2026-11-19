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
     * Returns the size in bytes of each file, in the order of the pairs (HY-114).
     *
     * @return list<int>
     */
    public function sizes(): array
    {
        $sizes = [];
        foreach ($this->pairs() as [, $files]) {
            foreach ($files as $file) {
                $sizes[] = $file->size();
            }
        }

        return $sizes;
    }
}
