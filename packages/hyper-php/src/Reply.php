<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The cookies and the cache control that the loaders and actions of one request give its response (HY-52), and the
 * notes that they give the response hook (HY-60).
 */
final class Reply
{
    /** @var list<array{string, string, ?int}> name, value and Max-Age */
    private array $cookies = [];

    private ?string $cacheControl = null;

    /** @var array<string, mixed> */
    private array $notes = [];

    /**
     * Records a value of the request for the response hook; a later note of the same name replaces the value and
     * keeps its position. The notes are not part of the response (HY-60).
     */
    public function note(string $name, mixed $value): self
    {
        $this->notes[$name] = $value;

        return $this;
    }

    /**
     * Returns the notes in the order of their first names.
     *
     * @return array<string, mixed>
     */
    public function notes(): array
    {
        return $this->notes;
    }

    /** Adds a cookie; a name or value outside HY-52 fails. */
    public function cookie(string $name, string $value, ?int $maxAge = null): self
    {
        if (preg_match('/^[a-z][a-z0-9_-]*$/D', $name) !== 1 || str_starts_with($name, 'hy-')) {
            throw new \InvalidArgumentException("cookie name {$name} is not allowed");
        }
        if (preg_match('/^[A-Za-z0-9._~-]+$/D', $value) !== 1) {
            throw new \InvalidArgumentException("cookie value of {$name} has a character that is not allowed");
        }
        if ($maxAge !== null && $maxAge < 0) {
            throw new \InvalidArgumentException("cookie {$name} has a negative Max-Age");
        }
        $this->cookies[] = [$name, $value, $maxAge];

        return $this;
    }

    /** Removes a cookie with Max-Age=0. */
    public function removeCookie(string $name): self
    {
        $this->cookie($name, 'x');
        $this->cookies[count($this->cookies) - 1] = [$name, '', 0];

        return $this;
    }

    /** Sets the Cache-Control of a page response with status 200. */
    public function cacheControl(string $value): self
    {
        if (preg_match('/^[\x20-\x7e]+$/D', $value) !== 1) {
            throw new \InvalidArgumentException('Cache-Control has a character that is not allowed');
        }
        $this->cacheControl = $value;

        return $this;
    }

    public function cacheControlValue(): ?string
    {
        return $this->cacheControl;
    }

    /** @return list<string> */
    public function cookieHeaders(bool $secure): array
    {
        return array_map(
            static fn (array $cookie): string => "{$cookie[0]}={$cookie[1]}; Path=/; HttpOnly; SameSite=Lax"
                . ($secure ? '; Secure' : '') . ($cookie[2] === null ? '' : "; Max-Age={$cookie[2]}"),
            $this->cookies,
        );
    }
}
