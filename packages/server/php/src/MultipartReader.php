<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The state machine that reads a `multipart/form-data` body in chunks (HY-131): it finds the delimiters, gives the
 * header lines and the content of each part to the reader that extends it, and holds besides one chunk at most the
 * delimiter or the header lines of one part.
 *
 * @internal
 */
abstract class MultipartReader
{
    /** The largest header of a part in bytes (HY-113.16). */
    private const HEADER_LIMIT = 8192;

    /** `--` and the boundary, and the same after the CRLF that ends the content of a part (HY-131.2, HY-131.3). */
    private readonly string $delimiter;

    private readonly string $separator;

    private string $buffer = '';

    /** One of preamble, delimiter, headers, content, done and failed. */
    private string $state = 'preamble';

    /** True until the body is known not to start with the delimiter. */
    private bool $first = true;

    public function __construct(string $boundary)
    {
        $this->delimiter = "--{$boundary}";
        $this->separator = "\r\n--{$boundary}";
    }

    /** Reads the next chunk of the body, and returns false when the body failed (HY-131.5). */
    public function feed(string $chunk): bool
    {
        if ($this->state === 'failed') {
            return false;
        }
        if ($this->state === 'done') {
            return true;
        }
        $this->buffer .= $chunk;
        while ($this->advance()) {
            continue;
        }

        return $this->state !== 'failed';
    }

    /** Returns true when the body ended with the `--` after a delimiter (HY-131.4). */
    public function closed(): bool
    {
        return $this->state === 'done';
    }

    /** Returns the number of bytes that the reader holds between two chunks. */
    public function buffered(): int
    {
        return strlen($this->buffer);
    }

    /**
     * Receives the header lines of a part, and returns false to fail the body.
     *
     * @param list<string> $lines
     */
    abstract public function partStarted(array $lines): bool;

    /** Receives the next bytes of the content of the part, and returns false to fail the body. */
    abstract public function partData(string $bytes): bool;

    /** Receives the end of the part, and returns false to fail the body. */
    abstract public function partEnded(): bool;

    /** Takes one step of the state machine, and returns false when it needs another chunk or has ended. */
    private function advance(): bool
    {
        $buffer = $this->buffer;
        $length = strlen($buffer);
        if ($this->state === 'preamble') {
            if ($this->first) {
                if ($length < strlen($this->delimiter)) {
                    if (str_starts_with($this->delimiter, $buffer)) {
                        return false;
                    }
                } elseif (str_starts_with($buffer, $this->delimiter)) {
                    $this->first = false;

                    return $this->next('delimiter', strlen($this->delimiter));
                }
                $this->first = false;
            }
            $index = strpos($buffer, $this->separator);
            if ($index !== false) {
                return $this->next('delimiter', $index + strlen($this->separator));
            }
            $this->buffer = substr($buffer, $length - min($length, strlen($this->separator) - 1));

            return false;
        }
        if ($this->state === 'delimiter') {
            if ($length < 2) {
                return false;
            }
            $after = substr($buffer, 0, 2);
            if ($after === '--') {
                $this->buffer = '';
                $this->state = 'done';

                return false;
            }

            return $after === "\r\n" ? $this->next('headers', 2) : $this->fail();
        }
        if ($this->state === 'headers') {
            if ($length < 2) {
                return false;
            }
            $empty = str_starts_with($buffer, "\r\n");
            $end = $empty ? 0 : strpos($buffer, "\r\n\r\n");
            if ($end === false) {
                return $length >= self::HEADER_LIMIT + 4 ? $this->fail() : false;
            }
            if ($end > self::HEADER_LIMIT) {
                return $this->fail();
            }
            $lines = $empty ? [] : explode("\r\n", substr($buffer, 0, $end));
            foreach ($lines as $line) {
                if (str_starts_with($line, $this->delimiter)) {
                    return $this->fail();
                }
            }
            $this->next('content', $empty ? 2 : $end + 4);

            return $this->partStarted($lines) || $this->fail();
        }
        if ($this->state === 'content') {
            $index = strpos($buffer, $this->separator);
            if ($index !== false) {
                if ($index > 0 && !$this->partData(substr($buffer, 0, $index))) {
                    return $this->fail();
                }
                if (!$this->partEnded()) {
                    return $this->fail();
                }

                return $this->next('delimiter', $index + strlen($this->separator));
            }
            $keep = min($length, strlen($this->separator) - 1);
            if ($length > $keep && !$this->partData(substr($buffer, 0, $length - $keep))) {
                return $this->fail();
            }
            $this->buffer = substr($buffer, $length - $keep);

            return false;
        }

        return false;
    }

    /** Drops the bytes that were read and enters the state. */
    private function next(string $state, int $read): bool
    {
        $this->buffer = substr($this->buffer, $read);
        $this->state = $state;

        return true;
    }

    private function fail(): bool
    {
        $this->buffer = '';
        $this->state = 'failed';

        return false;
    }
}
