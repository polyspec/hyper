<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** The outcome of an action: a redirect (HY-25) or a page with a status (HY-26, HY-58). */
final class Result
{
    /**
     * @param array<string, mixed> $data
     * @param array<string, mixed> $flash
     * @param list<string> $changed
     */
    private function __construct(
        public readonly ?string $location,
        public readonly int $status,
        public readonly array $data,
        public readonly array $flash,
        public readonly array $changed,
    ) {
    }

    /** Returns a redirect to a path of this application (HY-46). */
    public static function redirect(string $location): self
    {
        if (preg_match('#^/(?![/\\\\])[^\x{00}-\x{20}\x{7F}-\x{9F}\\\\]*$#Du', $location) !== 1 || self::hasDotSegment($location)) {
            throw new \InvalidArgumentException("redirect location {$location} is not an application path");
        }

        return new self($location, 303, [], [], []);
    }

    /** Returns true when the path of a location has a `.` or `..` segment, also with a percent-encoded dot. */
    private static function hasDotSegment(string $location): bool
    {
        $path = substr($location, 0, strcspn($location, '?#'));
        foreach (explode('/', $path) as $segment) {
            if (in_array(str_ireplace('%2e', '.', $segment), ['.', '..'], true)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Returns the route page with a status of 200, 409 or 422 and the data that the page renders (HY-58).
     *
     * @param array<string, mixed> $data
     */
    public static function page(int $status, array $data): self
    {
        if (!in_array($status, [200, 409, 422], true)) {
            throw new \InvalidArgumentException("page status {$status} is not 200, 409 or 422");
        }

        return new self(null, $status, $data, [], []);
    }

    /**
     * Returns invalid input with the data that the page renders: the page with status 422 (HY-26).
     *
     * @param array<string, mixed> $data
     */
    public static function invalid(array $data): self
    {
        return self::page(422, $data);
    }

    /** Returns a copy that stores a flash value for the next request. */
    public function flash(string $name, mixed $value): self
    {
        return new self($this->location, $this->status, $this->data, [...$this->flash, $name => $value], $this->changed);
    }

    /** Returns a copy that records changed topics for the next request. */
    public function changed(string ...$topics): self
    {
        return new self($this->location, $this->status, $this->data, $this->flash, array_values(array_unique([...$this->changed, ...$topics])));
    }

    /** Returns true for a redirect. */
    public function isRedirect(): bool
    {
        return $this->location !== null;
    }
}
