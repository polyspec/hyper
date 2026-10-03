<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The cookies, the cache control and the page status that the loaders and actions of one request give its response
 * (HY-52, HY-69), and the notes that they give the response hook (HY-60).
 */
final class Reply
{
    /** @var list<array{string, string, ?int}> name, value and Max-Age */
    private array $cookies = [];

    private ?string $cacheControl = null;

    private bool $renewal = false;

    private ?int $status = null;

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

    /**
     * Sets the Cache-Control of a page response with status 200. A page carries the session token of its visitor, so
     * the value keeps it out of shared caches: it has `private` or `no-store` and neither `public` nor `s-maxage`
     * (HY-52).
     */
    public function cacheControl(string $value): self
    {
        if (preg_match('/^[\x20-\x7e]+$/D', $value) !== 1) {
            throw new \InvalidArgumentException('Cache-Control has a character that is not allowed');
        }
        $directives = array_map(fn (string $part): string => strtolower(trim(explode('=', $part, 2)[0])), explode(',', $value));
        if (array_intersect($directives, ['private', 'no-store']) === [] || array_intersect($directives, ['public', 's-maxage']) !== []) {
            throw new \InvalidArgumentException("Cache-Control {$value} lets a shared cache store the page; it needs private or no-store and neither public nor s-maxage");
        }
        $this->cacheControl = $value;

        return $this;
    }

    /** Renews the session after the action of the request returns (HY-72). */
    public function renewSession(): self
    {
        $this->renewal = true;

        return $this;
    }

    /** Returns whether a renewal was requested since the last call, and clears the request. */
    public function takeRenewal(): bool
    {
        $renewal = $this->renewal;
        $this->renewal = false;

        return $renewal;
    }

    public function cacheControlValue(): ?string
    {
        return $this->cacheControl;
    }

    /**
     * Gives a page response that has status 200 otherwise the status 403, for a page that shows other data in place
     * of the data that the request may not see; another status fails (HY-69).
     */
    public function status(int $status): self
    {
        if ($status !== 403) {
            throw new \InvalidArgumentException("page status {$status} of a reply is not 403");
        }
        $this->status = $status;

        return $this;
    }

    public function statusValue(): ?int
    {
        return $this->status;
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
