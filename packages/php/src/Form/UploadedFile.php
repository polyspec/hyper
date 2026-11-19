<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * A file that a request sent in a file part (HY-113): its name, its filename, its content type and its bytes. It holds
 * a file of the core, `FormFile` (form_file), whose bytes are a value or a temporary file of the request for a body
 * that the server read (HY-131, H35.11); http-form reads and moves it (F-11, F-22).
 */
final class UploadedFile
{
    /** The file of the core, which holds, reads and moves the bytes. */
    private FormFile $core;

    public function __construct(string $name, string $filename, string $contentType, string $content)
    {
        ArgumentCount::most(\func_num_args(), 4);
        $this->core = new FormFile($name, $filename, $contentType, $content);
    }

    /**
     * Returns the file of a form of the core (HY-131.28, H35.11).
     *
     * @internal
     */
    public static function ofCore(FormFile $core): self
    {
        $file = (new \ReflectionClass(self::class))->newInstanceWithoutConstructor();
        $file->core = $core;

        return $file;
    }

    /** Returns the name of the part, the `name` parameter of its Content-Disposition. */
    public function name(): string
    {
        ArgumentCount::most(\func_num_args(), 0);
        return $this->core->name();
    }

    /** Returns the filename parameter of the part, as it was sent (HY-113.21). */
    public function filename(): string
    {
        ArgumentCount::most(\func_num_args(), 0);
        return $this->core->filename();
    }

    /** Returns the Content-Type header of the part as it was sent, or the empty text when it has none. */
    public function contentType(): string
    {
        ArgumentCount::most(\func_num_args(), 0);
        return $this->core->contentType();
    }

    /** Returns the number of bytes of the part (HY-131.28). */
    public function size(): int
    {
        ArgumentCount::most(\func_num_args(), 0);
        return $this->core->size();
    }

    /** Returns the bytes of the part as one value, and fails with the kind `moved` of http-form after a move (HY-131.28). */
    public function content(): string
    {
        ArgumentCount::most(\func_num_args(), 0);
        return $this->core->content();
    }

    /**
     * Moves the file to the path through the core, which fails with the kind `exists` when the path exists and with
     * `moved` when the file was moved (HY-131.28, F-11).
     */
    public function moveTo(mixed $path): void
    {
        ArgumentCount::most(\func_num_args(), 1);
        if (!is_string($path)) {
            throw new \TypeError('a path is not a string (F-11)');
        }
        $this->core->moveTo($path);
    }
}
