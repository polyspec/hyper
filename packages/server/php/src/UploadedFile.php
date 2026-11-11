<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * A file that a request sent in a file part (HY-113): its name, its filename, its content type and its bytes. The
 * bytes are a value, or a temporary file of the request for a body that the server read in chunks (HY-131).
 */
final class UploadedFile
{
    private ?string $bytes;

    private ?string $path = null;

    private int $length;

    private bool $moved = false;

    public function __construct(
        private readonly string $name,
        private readonly string $filename,
        private readonly string $contentType,
        string $content,
    ) {
        $this->bytes = $content;
        $this->length = strlen($content);
    }

    /**
     * Returns a file whose bytes are the file of the path, of the size in bytes (HY-131.13).
     *
     * @internal
     */
    public static function stored(string $name, string $filename, string $contentType, string $path, int $size): self
    {
        $file = new self($name, $filename, $contentType, '');
        $file->bytes = null;
        $file->path = $path;
        $file->length = $size;

        return $file;
    }

    /** Returns the name of the part, the `name` parameter of its Content-Disposition. */
    public function name(): string
    {
        return $this->name;
    }

    /** Returns the filename parameter of the part, as it was sent (HY-113.14). */
    public function filename(): string
    {
        return $this->filename;
    }

    /** Returns the Content-Type header of the part as it was sent, or the empty text when it has none. */
    public function contentType(): string
    {
        return $this->contentType;
    }

    /** Returns the number of bytes of the part (HY-131.15). */
    public function size(): int
    {
        return $this->length;
    }

    /** Returns the bytes of the part as one value, and fails after a move (HY-131.16). */
    public function content(): string
    {
        if ($this->moved) {
            throw new \InvalidArgumentException('the file was moved (HY-131)');
        }
        if ($this->bytes !== null) {
            return $this->bytes;
        }
        if ($this->path === null) {
            throw new \LogicException('hyper: a stored file has no path');
        }
        $bytes = file_get_contents($this->path);
        if ($bytes === false) {
            throw new \RuntimeException("hyper: cannot read {$this->path}");
        }

        return $bytes;
    }

    /**
     * Moves the file to the path, and fails when the path exists or when the file was moved (HY-131.15, HY-131.16).
     */
    public function moveTo(mixed $path): void
    {
        if (!is_string($path)) {
            throw new \TypeError('a path is not a string (HY-131)');
        }
        if ($this->moved) {
            throw new \InvalidArgumentException('the file was moved (HY-131)');
        }
        if ($this->path === null) {
            $target = self::createdFile($path);
            $written = fwrite($target, $this->bytes ?? '');
            fclose($target);
            if ($written !== $this->length) {
                throw new \RuntimeException("hyper: cannot write {$path}");
            }
        } else {
            self::linkedFile($this->path, $path);
            if (!unlink($this->path)) {
                throw new \RuntimeException("hyper: cannot remove {$this->path}");
            }
        }
        $this->bytes = null;
        $this->moved = true;
    }

    /**
     * Opens a new file at the path for writing, and fails when the path exists.
     *
     * @return resource
     */
    private static function createdFile(string $path): mixed
    {
        if (file_exists($path)) {
            throw new \InvalidArgumentException('the path exists (HY-131)');
        }
        // The mode x fails for a path that another process created since the check, so no file is replaced.
        $target = fopen($path, 'x');
        if ($target === false) {
            throw new \RuntimeException("hyper: cannot create {$path}");
        }
        chmod($path, 0600);

        return $target;
    }

    /**
     * Gives the file of the source the path as a second name, or copies it there when the file system gives no second
     * name, as between two file systems; fails when the path exists.
     */
    private static function linkedFile(string $source, string $path): void
    {
        if (file_exists($path)) {
            throw new \InvalidArgumentException('the path exists (HY-131)');
        }
        // link fails with a warning between two file systems and on a file system without second names; its result
        // decides, and the copy below then moves the file.
        set_error_handler(static fn (): bool => true);
        try {
            $linked = link($source, $path);
        } finally {
            restore_error_handler();
        }
        if ($linked) {
            return;
        }
        $target = self::createdFile($path);
        $from = fopen($source, 'r');
        if ($from === false) {
            fclose($target);

            throw new \RuntimeException("hyper: cannot read {$source}");
        }
        $copied = stream_copy_to_stream($from, $target);
        fclose($from);
        fclose($target);
        if ($copied === false) {
            throw new \RuntimeException("hyper: cannot write {$path}");
        }
    }
}
