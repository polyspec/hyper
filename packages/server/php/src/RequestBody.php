<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server;

/**
 * The body of a request as its host reads it (HY-59, HY-131): the bytes of a body that is one value, or the parts of
 * a `multipart/form-data` body that is read in chunks, whose files are in a directory of the request.
 *
 * @internal
 */
final class RequestBody
{
    private readonly ?Multipart $multipart;

    private readonly ?string $files;

    private string $content = '';

    private int $length = 0;

    private bool $over = false;

    /**
     * Starts the body of the content type with the body limit; `$stream` tells whether a multipart body is read in
     * chunks, which it is when `multipart/form-data` is a form type of the application (HY-131.1). The value limit
     * bounds a body that is one value and the text values of a body read in chunks, the part limit its parts and the
     * file limit each of its files (HY-131.7 to HY-131.12).
     */
    public function __construct(
        string $type,
        private readonly int $limit,
        bool $stream,
        private readonly int $valueLimit,
        int $partLimit,
        int $fileLimit,
    ) {
        $boundary = $stream ? Multipart::boundary($type) : null;
        $this->files = $boundary === null ? null : self::createdDirectory();
        $this->multipart = $boundary === null
            ? null
            : new Multipart($boundary, $this->files, $valueLimit, $partLimit, $fileLimit);
    }

    /**
     * Reads the next chunk, and returns false when the body passed a limit, after which it holds no bytes (HY-59.4,
     * HY-131.11).
     */
    public function feed(string $chunk): bool
    {
        if ($this->over) {
            return false;
        }
        $this->length += strlen($chunk);
        if ($this->length > $this->limit || ($this->multipart === null && $this->length > $this->valueLimit)) {
            return $this->bodyPassed();
        }
        if ($this->multipart === null) {
            $this->content .= $chunk;
        } elseif (!$this->multipart->feed($chunk) && $this->multipart->exceeded()) {
            return $this->bodyPassed();
        }

        return true;
    }

    /**
     * Returns true when the body passed the body limit, the value limit, the part limit or the file limit
     * (HY-131.11).
     */
    public function exceeded(): bool
    {
        return $this->over;
    }

    /** Records that the body passed a limit and drops what it holds. */
    private function bodyPassed(): bool
    {
        $this->over = true;
        $this->content = '';
        $this->multipart?->release();

        return false;
    }

    /** Returns the number of bytes that were read. */
    public function size(): int
    {
        return $this->length;
    }

    /** Returns the body as one value: no bytes for a body read in chunks and for a body that passed the limit. */
    public function held(): string
    {
        return $this->content;
    }

    /** Returns true when the body is read in chunks. */
    public function streamed(): bool
    {
        return $this->multipart !== null;
    }

    /**
     * Returns the text fields and the files of a body read in chunks, or null when it failed, has not ended or
     * passed the limit (HY-131.5).
     *
     * @return array{0: Fields, 1: Files}|null
     */
    public function parts(): ?array
    {
        return $this->multipart === null || $this->over ? null : $this->multipart->result();
    }

    /** Returns the directory of the files of the body, or null for a body that is one value. */
    public function directory(): ?string
    {
        return $this->files;
    }

    /** Removes the directory of the files with the files that were not moved (HY-131.14). */
    public function remove(): void
    {
        $this->multipart?->release();
        if ($this->files === null || !is_dir($this->files)) {
            return;
        }
        foreach (scandir($this->files) ?: [] as $entry) {
            if ($entry !== '.' && $entry !== '..' && !unlink("{$this->files}/{$entry}")) {
                throw new \RuntimeException("hyper: cannot remove {$this->files}/{$entry}");
            }
        }
        if (!rmdir($this->files)) {
            throw new \RuntimeException("hyper: cannot remove {$this->files}");
        }
    }

    /** Creates a directory below the temporary directory of the system for the user of the server only. */
    private static function createdDirectory(): string
    {
        // mkdir fails for a path that exists, so no request takes the directory of another one.
        $path = sys_get_temp_dir() . '/hyper-' . bin2hex(random_bytes(16));
        if (!mkdir($path, 0700)) {
            throw new \RuntimeException("hyper: cannot create {$path}");
        }

        return $path;
    }
}
