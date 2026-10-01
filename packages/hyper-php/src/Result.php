<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** The outcome of an action: a redirect (HY-17) or invalid input (HY-18). */
final class Result
{
    /**
     * @param array<string, mixed> $data
     * @param array<string, mixed> $flash
     * @param list<string> $changed
     */
    private function __construct(
        public readonly ?string $location,
        public readonly array $data,
        public readonly array $flash,
        public readonly array $changed,
    ) {
    }

    /** Returns a redirect to a path of this application. */
    public static function redirect(string $location): self
    {
        if (!str_starts_with($location, '/') || str_starts_with($location, '//')) {
            throw new \InvalidArgumentException("redirect location {$location} is not an application path");
        }

        return new self($location, [], [], []);
    }

    /**
     * Returns invalid input with the data that the page renders.
     *
     * @param array<string, mixed> $data
     */
    public static function invalid(array $data): self
    {
        return new self(null, $data, [], []);
    }

    /** Returns a copy that stores a flash value for the next request. */
    public function flash(string $name, mixed $value): self
    {
        return new self($this->location, $this->data, [...$this->flash, $name => $value], $this->changed);
    }

    /** Returns a copy that records changed topics for the next request. */
    public function changed(string ...$topics): self
    {
        return new self($this->location, $this->data, $this->flash, array_values(array_unique([...$this->changed, ...$topics])));
    }

    /** Returns true for a redirect. */
    public function isRedirect(): bool
    {
        return $this->location !== null;
    }
}
