<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The body of a request as its host reads it, through `RequestBody` of the core, which reads it with http-form under
 * the four limits and in their order (HY-59.15, HY-131.32, H35.11): the bytes of a body that is one value, or the
 * parts of a `multipart/form-data` body read in chunks, whose files are in a directory of the request. The server
 * holds no parser and no limit check of its own.
 *
 * @internal
 */
final class BodyReader
{
    /**
     * The largest limit that the binding takes: its type uint holds the integers up to 2^53 - 1 and fails a larger one
     * with kind invalid_number (binding GN-12a), and PHP_INT_MAX, the limit of a server without one, is above it; no
     * body reaches that size.
     */
    private const NO_LIMIT = 9_007_199_254_740_991;

    /**
     * The fields of the record body_limits, which the binding takes as the last arguments of the member that reads a
     * body, each limit at most NO_LIMIT.
     *
     * @return array{limit: int, valueLimit: int, partLimit: int, fileLimit: int}
     *
     * @internal
     */
    public static function limits(int $limit, int $valueLimit, int $partLimit, int $fileLimit): array
    {
        return [
            'limit' => min($limit, self::NO_LIMIT),
            'valueLimit' => min($valueLimit, self::NO_LIMIT),
            'partLimit' => min($partLimit, self::NO_LIMIT),
            'fileLimit' => min($fileLimit, self::NO_LIMIT),
        ];
    }

    /** The body of the core. */
    private readonly RequestBody $body;

    /** The failure of the body, or null while it reads. */
    private ?\Throwable $failure = null;

    /**
     * Starts the body of the content type with the four limits; `$stream` tells whether a multipart body is read in
     * chunks, which it is when `multipart/form-data` is a form type of the application (HY-131.1). `$contentLength` is
     * the value of the `Content-Length` field, or null without one: the core fails a value that is no number with
     * `invalid_content_length` and a number above the body limit with `body_limit` before any byte is read
     * (HY-131.29); that failure is the failure of the body, which then reads no chunk.
     */
    public function __construct(
        string $type,
        int $limit,
        bool $stream,
        int $valueLimit,
        int $partLimit,
        int $fileLimit,
        ?string $contentLength = null,
    ) {
        $limits = self::limits($limit, $valueLimit, $partLimit, $fileLimit);
        $contentType = $type === '' ? null : $type;
        try {
            $this->body = RequestBody::start($contentType, $contentLength, $stream, ...$limits);
        } catch (HyperValueError $error) {
            $this->failure = $error;
            $this->body = RequestBody::start($contentType, null, $stream, ...$limits);
        }
    }

    /**
     * Reads the next chunk, and returns false when the body failed: when it passed a limit (HY-131.32) or when its
     * bytes fail with kind `invalid` or `header_limit` (HY-113.23, HY-113.25), after which no chunk is read.
     */
    public function feed(string $chunk): bool
    {
        if ($this->failure !== null) {
            return false;
        }
        try {
            $this->body->feed($chunk);
        } catch (HyperValueError $error) {
            $this->failure = $error;

            return false;
        }

        return true;
    }

    /** Ends the body; a failure at its end is the failure of the body. */
    public function finish(): void
    {
        if ($this->failure !== null) {
            return;
        }
        try {
            $this->body->finish();
        } catch (HyperValueError $error) {
            $this->failure = $error;
        }
    }

    /** Returns true when the body passed the body limit, the value limit, the part limit or the file limit. */
    public function exceeded(): bool
    {
        return self::overLimit($this->failure);
    }

    /** Returns true when the failure is one of a limit, whose status is 413 (F-25). */
    public static function overLimit(?\Throwable $failure): bool
    {
        return $failure instanceof HyperValueError && $failure->status() === 413;
    }

    /** Returns the number of bytes that were read. */
    public function size(): int
    {
        return $this->body->size();
    }

    /** Returns the body as one value: no bytes for a body read in chunks and for a body that failed. */
    public function held(): string
    {
        return $this->body->held();
    }

    /** Returns true when the body is read in chunks. */
    public function streamed(): bool
    {
        return $this->body->streamed();
    }

    /**
     * Returns the text fields and the files of a body read in chunks, or null when it failed (HY-131.5).
     *
     * @return array{0: Fields, 1: Files}|null
     */
    public function parts(): ?array
    {
        try {
            return $this->read();
        } catch (HyperValueError) {
            return null;
        }
    }

    /**
     * Returns the parts as `parts` does, and fails with the failure of the body where `parts` returns null.
     *
     * @return array{0: Fields, 1: Files}
     */
    public function read(): array
    {
        if ($this->failure !== null) {
            throw $this->failure;
        }

        return self::named($this->body->parts());
    }

    /** Returns the failure of the body, or null while it reads. */
    public function failure(): ?\Throwable
    {
        return $this->failure;
    }

    /** Returns the directory of the files of the body, or null for a body that is one value. */
    public function directory(): ?string
    {
        return $this->body->directory();
    }

    /** Removes the directory of the files with the files that were not moved (HY-131.14). */
    public function remove(): void
    {
        $this->body->remove();
    }

    /**
     * Returns the fields and the files of a form of the core as the containers of the server.
     *
     * @return array{0: Fields, 1: Files}
     */
    public static function named(Form $form): array
    {
        $names = [];
        $values = [];
        foreach ($form->fields as [$name, $items]) {
            $names[] = $name;
            $values[$name] = $items;
        }
        $fileNames = [];
        $files = [];
        foreach ($form->files as [$name, $items]) {
            $fileNames[] = $name;
            $files[$name] = array_map(static fn (object $file): UploadedFile => UploadedFile::ofCore($file), $items);
        }

        return [new Fields($names, $values), new Files($fileNames, $files)];
    }
}
