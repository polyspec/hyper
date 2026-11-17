<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * A file that a request sent in a file part (HY-113): its name, its filename, its content type and its bytes. The
 * bytes are a value, or the file of the core for a body that the server read (HY-131, H35.11), which http-form reads
 * and moves (F-11).
 */
final class UploadedFile
{
    private ?string $bytes;

    private int $length;

    private bool $moved = false;

    /** The file of the core, which reads and moves its bytes, or null for a file whose bytes are a value. */
    private ?object $core = null;

    public function __construct(
        private readonly string $name,
        private readonly string $filename,
        private readonly string $contentType,
        string $content,
    ) {
        ArgumentCount::most(\func_num_args(), 4);
        $this->bytes = $content;
        $this->length = strlen($content);
    }

    /**
     * Returns the file of a form of the core (HY-131.13, H35.11).
     *
     * @internal
     */
    public static function ofCore(object $core): self
    {
        $file = new self($core->name(), $core->filename(), $core->contentType(), '');
        $file->bytes = null;
        $file->core = $core;
        $file->length = $core->size();

        return $file;
    }

    /** Returns the name of the part, the `name` parameter of its Content-Disposition. */
    public function name(): string
    {
        ArgumentCount::most(\func_num_args(), 0);
        return $this->name;
    }

    /** Returns the filename parameter of the part, as it was sent (HY-113.14). */
    public function filename(): string
    {
        ArgumentCount::most(\func_num_args(), 0);
        return $this->filename;
    }

    /** Returns the Content-Type header of the part as it was sent, or the empty text when it has none. */
    public function contentType(): string
    {
        ArgumentCount::most(\func_num_args(), 0);
        return $this->contentType;
    }

    /** Returns the number of bytes of the part (HY-131.15). */
    public function size(): int
    {
        ArgumentCount::most(\func_num_args(), 0);
        return $this->length;
    }

    /** Returns the bytes of the part as one value, and fails after a move (HY-131.16). */
    public function content(): string
    {
        ArgumentCount::most(\func_num_args(), 0);
        if ($this->core !== null) {
            return $this->core->content();
        }
        if ($this->moved) {
            throw new \InvalidArgumentException('the file was moved (HY-131)');
        }
        return $this->bytes ?? '';
    }

    /**
     * Moves the file to the path, and fails when the path exists or when the file was moved (HY-131.15, HY-131.16).
     */
    public function moveTo(mixed $path): void
    {
        ArgumentCount::most(\func_num_args(), 1);
        if (!is_string($path)) {
            throw new \TypeError('a path is not a string (F-11)');
        }
        if ($this->core !== null) {
            $this->core->moveTo($path);

            return;
        }
        if ($this->moved) {
            throw new \InvalidArgumentException('the file was moved (HY-131)');
        }
        $target = self::createdFile($path);
        $written = fwrite($target, $this->bytes ?? '');
        fclose($target);
        if ($written !== $this->length) {
            throw new \RuntimeException("hyper: cannot write {$path}");
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
}
