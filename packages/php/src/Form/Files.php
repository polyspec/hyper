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
     * the body fails (HY-113.15, HY-113.23, HY-113.25).
     */
    public static function fromBody(string $type, string $body): ?self
    {
        return self::heldForm($type, $body)[1] ?? null;
    }

    /**
     * Returns the fields and the files of a body held as one value through `readHeldBody` of the core, without a
     * limit, or null when the body fails. A content type that is no media type, and a multipart type without a
     * boundary, give no field and no file, because the `Content-Type` is judged after the route (HY-57.15, HY-59.12,
     * HY-113.24).
     *
     * @return array{0: Fields, 1: Files}|null
     */
    public static function heldForm(string $type, string $body): ?array
    {
        try {
            return self::readHeld($type, $body);
        } catch (HyperValueError) {
            return null;
        }
    }

    /**
     * Returns the fields and the files of a body held as one value as `heldForm` does, and fails with the error of the
     * core where `heldForm` returns null (HY-113.23, HY-113.25).
     *
     * @return array{0: Fields, 1: Files}
     *
     * @internal
     */
    public static function readHeld(string $type, string $body): array
    {
        $none = BodyReader::limits(PHP_INT_MAX, PHP_INT_MAX, PHP_INT_MAX, PHP_INT_MAX);
        try {
            return BodyReader::named(readHeldBody($type === '' ? null : $type, $body, ...$none));
        } catch (HyperValueError $error) {
            if (in_array($error->kind(), ['malformed_content_type', 'no_boundary'], true)) {
                return [Fields::empty(), self::empty()];
            }

            throw $error;
        }
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
