<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * Reads the parts of a `multipart/form-data` body without PHP's own reader, which needs `enable_post_data_reading`
 * (HY-57): a part whose `Content-Disposition` is `form-data` with a `name` and no `filename` is a text field, a part
 * with a `name` and a `filename` is a file, and another part is neither (HY-113).
 *
 * @internal
 */
final class Multipart extends MultipartReader
{
    /** @var list<string> */
    private array $names;

    /** @var array<array-key, list<string>> */
    private array $values;

    /** @var list<string> */
    private array $fileNames;

    /** @var array<array-key, list<UploadedFile>> */
    private array $files;

    /** The name of the part that is read, or null for a part that is neither a value nor a file (HY-113.6). */
    private ?string $name;

    /**
     * The filename and the content type of the file part that is read, or null for a text field.
     *
     * @var array{string, string}|null
     */
    private ?array $file;

    private string $content;

    /**
     * The file that the content of the file part is written to, with its path and the bytes given to it.
     *
     * @var resource|null
     */
    private mixed $target;

    private string $path;

    private int $size;

    private int $stored;

    private int $valueBytes;

    private int $partCount;

    private bool $over;

    /**
     * @param ?string $directory the directory of the files of the body, or null for files that are values (HY-131.13)
     * @param ?int $valueLimit the largest bytes of the names and contents of the text values together, or null
     * @param ?int $partLimit the largest number of parts, or null
     * @param ?int $fileLimit the largest bytes of one file, or null (HY-131.7 to HY-131.12)
     */
    public function __construct(
        string $boundary,
        private readonly ?string $directory,
        private readonly ?int $valueLimit,
        private readonly ?int $partLimit,
        private readonly ?int $fileLimit,
    ) {
        parent::__construct($boundary);
        $this->target = null;
        $this->path = '';
        $this->size = 0;
        $this->stored = 0;
        $this->valueBytes = 0;
        $this->partCount = 0;
        $this->over = false;
        $this->names = [];
        $this->values = [];
        $this->fileNames = [];
        $this->files = [];
        $this->name = null;
        $this->file = null;
        $this->content = '';
    }

    /** Returns the boundary of a `multipart/form-data` content type, or null for another type (HY-113.11). */
    public static function boundary(string $type): ?string
    {
        [$kind, $parameters] = self::headerParameters($type);
        $boundary = $parameters['boundary'] ?? '';

        return $kind !== 'multipart/form-data' || $boundary === '' ? null : $boundary;
    }

    /**
     * Returns the text fields and the files of the body, or null when the body fails with HY-42 (HY-113, HY-131).
     *
     * @return array{0: Fields, 1: Files}|null
     */
    public static function read(string $body, string $boundary): ?array
    {
        $reader = new self($boundary, null, null, null, null);

        return $reader->feed($body) ? $reader->result() : null;
    }

    /**
     * Returns the text fields and the files that were read, or null for a body that failed or has not ended
     * (HY-131.5).
     *
     * @return array{0: Fields, 1: Files}|null
     */
    public function result(): ?array
    {
        return $this->closed()
            ? [new Fields($this->names, $this->values), new Files($this->fileNames, $this->files)]
            : null;
    }

    /** Returns true when the body passed the value limit, the part limit or the file limit (HY-131.11). */
    public function exceeded(): bool
    {
        return $this->over;
    }

    /** Returns the number of parts that were read, also those that are neither a value nor a file (HY-131.12). */
    public function count(): int
    {
        return $this->partCount;
    }

    public function partStarted(array $lines): bool
    {
        $this->name = null;
        $this->file = null;
        $this->content = '';
        $this->partCount++;
        if ($this->partLimit !== null && $this->partCount > $this->partLimit) {
            return $this->limitPassed();
        }
        $disposition = self::headerValue($lines, 'content-disposition');
        if ($disposition === null) {
            return true;
        }
        [$kind, $parameters] = self::headerParameters($disposition);
        if ($kind !== 'form-data' || !array_key_exists('name', $parameters)) {
            return true;
        }
        if (array_key_exists('filename', $parameters)) {
            $text = self::utf8Text($parameters['filename']);
            $type = self::utf8Text(self::headerValue($lines, 'content-type') ?? '');
            if ($text === null || $type === null) {
                return false;
            }
            $this->file = [$text, $type];
        }
        $this->name = self::utf8Text($parameters['name']);
        if ($this->name === null) {
            return false;
        }
        $this->size = 0;
        if ($this->file === null) {
            // The name counts as its bytes were sent.
            $this->valueBytes += strlen($parameters['name']);
            if ($this->valueLimit !== null && $this->valueBytes > $this->valueLimit) {
                return $this->limitPassed();
            }
        }
        if ($this->file !== null && $this->directory !== null) {
            $this->stored++;
            $this->path = "{$this->directory}/{$this->stored}";
            // The mode x fails for a path that exists; the directory gives its files to the user of the server only.
            $target = fopen($this->path, 'x');
            if ($target === false) {
                throw new \RuntimeException("hyper: cannot create {$this->path}");
            }
            $this->target = $target;
        }

        return true;
    }

    public function partData(string $bytes): bool
    {
        if ($this->name === null) {
            return true;
        }
        if ($this->file === null) {
            $this->valueBytes += strlen($bytes);
            if ($this->valueLimit !== null && $this->valueBytes > $this->valueLimit) {
                return $this->limitPassed();
            }
        } else {
            $this->size += strlen($bytes);
            if ($this->fileLimit !== null && $this->size > $this->fileLimit) {
                return $this->limitPassed();
            }
        }
        if ($this->target === null) {
            $this->content .= $bytes;
        } elseif (fwrite($this->target, $bytes) !== strlen($bytes)) {
            throw new \RuntimeException("hyper: cannot write {$this->path}");
        }

        return true;
    }

    /** Records that the body passed a limit, and fails the body. */
    private function limitPassed(): bool
    {
        $this->over = true;
        $this->content = '';

        return false;
    }

    /** Closes the file of a part whose end was not read. */
    public function release(): void
    {
        if ($this->target !== null) {
            fclose($this->target);
            $this->target = null;
        }
    }

    public function partEnded(): bool
    {
        if ($this->name === null) {
            return true;
        }
        $content = $this->content;
        $this->content = '';
        if ($this->file === null) {
            $value = self::utf8Text($content);
            if ($value === null) {
                return false;
            }
            self::addValue($this->names, $this->values, $this->name, $value);
        } elseif ($this->target === null) {
            $file = new UploadedFile($this->name, $this->file[0], $this->file[1], $content);
            self::addValue($this->fileNames, $this->files, $this->name, $file);
        } else {
            if (!fclose($this->target)) {
                throw new \RuntimeException("hyper: cannot write {$this->path}");
            }
            $this->target = null;
            $file = UploadedFile::stored($this->name, $this->file[0], $this->file[1], $this->path, $this->size);
            self::addValue($this->fileNames, $this->files, $this->name, $file);
        }

        return true;
    }

    /**
     * Returns the text before the first `;` without the spaces and tabs around it, in lower case, and the parameters
     * after it by their names in lower case: each follows a `;` and spaces or tabs, its value is a quoted string
     * without its quotes or the text up to the next `;`, space or tab, and the first parameter of a name counts
     * (HY-113.13).
     *
     * @return array{string, array<array-key, string>}
     */
    private static function headerParameters(string $text): array
    {
        $parameters = [];
        $length = strlen($text);
        $index = strpos($text, ';');
        $kind = strtolower(trim($index === false ? $text : substr($text, 0, $index), " \t"));
        while ($index !== false) {
            $index += 1 + strspn($text, " \t", $index + 1);
            $start = $index;
            $index += strcspn($text, '=;', $index);
            if ($index >= $length || $text[$index] !== '=') {
                $index = $index < $length ? $index : false;
                continue;
            }
            $name = strtolower(substr($text, $start, $index - $start));
            $index += 1;
            if ($index < $length && $text[$index] === '"') {
                $close = strpos($text, '"', $index + 1);
                $value = substr($text, $index + 1, ($close === false ? $length : $close) - $index - 1);
                $index = $close === false ? $length : $close + 1;
            } else {
                $size = strcspn($text, "; \t", $index);
                $value = substr($text, $index, $size);
                $index += $size;
            }
            if (!array_key_exists($name, $parameters)) {
                $parameters[$name] = $value;
            }
            $index = $index < $length ? strpos($text, ';', $index) : false;
        }

        return [$kind, $parameters];
    }

    /**
     * Returns the value of the first header line of the name, compared without case, without the spaces and tabs
     * around it, or null when no line has the name (HY-113.12).
     *
     * @param list<string> $lines
     */
    private static function headerValue(array $lines, string $name): ?string
    {
        foreach ($lines as $line) {
            $colon = strpos($line, ':');
            if ($colon !== false && strtolower(substr($line, 0, $colon)) === $name) {
                return trim(substr($line, $colon + 1), " \t");
            }
        }

        return null;
    }

    /**
     * Appends a value to its name, and the name to the names at its first value.
     *
     * @template T
     *
     * @param list<string> $names
     * @param array<array-key, list<T>> $values
     * @param T $value
     */
    private static function addValue(array &$names, array &$values, string $name, mixed $value): void
    {
        if (!array_key_exists($name, $values)) {
            $names[] = $name;
            $values[$name] = [];
        }
        $values[$name][] = $value;
    }

    /** Returns the bytes when they are UTF-8, or null. */
    private static function utf8Text(string $bytes): ?string
    {
        return preg_match('//u', $bytes) === 1 ? $bytes : null;
    }
}
