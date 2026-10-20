<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * A file that a request sent in a file part (HY-113): its name, its filename, its content type and its bytes.
 */
final class UploadedFile
{
    public function __construct(
        private readonly string $name,
        private readonly string $filename,
        private readonly string $contentType,
        private readonly string $content,
    ) {
    }

    /** Returns the name of the part, the `name` parameter of its Content-Disposition. */
    public function name(): string
    {
        return $this->name;
    }

    /** Returns the filename parameter of the part, with the escapes of its quoted string undone. */
    public function filename(): string
    {
        return $this->filename;
    }

    /** Returns the Content-Type header of the part as it was sent, or the empty text when it has none. */
    public function contentType(): string
    {
        return $this->contentType;
    }

    /** Returns the bytes of the part. */
    public function content(): string
    {
        return $this->content;
    }
}
