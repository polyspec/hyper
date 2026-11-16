<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The cookies, the cache control, the page status and the embedding of the data that the loaders and actions of one
 * request give its response (HY-52, HY-69, HY-92), and the notes that they give the response hook (HY-60).
 */
final class Reply
{
    /** @var list<array{string, string, ?int}> name, value and Max-Age */
    private array $cookies = [];

    private ?string $cacheControl = null;

    private ?string $referrerPolicy = null;

    private bool $renewal = false;

    private ?int $status = null;

    private bool $embed = false;

    /** @var array<array-key, mixed> the values by name, whose decimal names PHP keeps as integer keys */
    private array $notes = [];

    /**
     * Records a value of the request for the response hook; a later note of the same name replaces the value and
     * keeps its position. The notes are not part of the response (HY-60).
     */
    public function note(mixed $name, mixed $value): self
    {
        ArgumentCount::most(\func_num_args(), 2);
        // HY-60.28: a declared type would convert an integer name for a caller without strict types.
        if (!is_string($name)) {
            throw new HyperTypeError('a note name is not a string (HY-60)', 'invalid_argument_type');
        }
        $this->notes[$name] = $value;

        return $this;
    }

    /**
     * Returns the notes as pairs of a name and its value, in the order of their first names (HY-60.29): a pair keeps a
     * decimal name a string, which a PHP array key would make an integer.
     *
     * @return list<array{string, mixed}>
     */
    public function notes(): array
    {
        ArgumentCount::most(\func_num_args(), 0);
        $pairs = [];
        foreach ($this->notes as $name => $value) {
            $pairs[] = [(string) $name, $value];
        }

        return $pairs;
    }

    /**
     * Adds a cookie; a name, value or Max-Age of another type (HY-52.11) or outside HY-52 (HY-52.12) fails. The types
     * are checked before the values, in the order of the parameters; a declared type would convert them for a caller
     * without strict types.
     */
    public function cookie(mixed $name, mixed $value, mixed $maxAge = null): self
    {
        ArgumentCount::most(\func_num_args(), 3);
        if (!is_string($name)) {
            throw new HyperTypeError('a cookie name is not a string (HY-52)', 'invalid_argument_type');
        }
        if (!is_string($value)) {
            throw new HyperTypeError('a cookie value is not a string (HY-52)', 'invalid_argument_type');
        }
        $age = $maxAge === null ? null : self::integer($maxAge);
        if ($maxAge !== null && $age === null) {
            throw new HyperValueError('a Max-Age is not an integer within ±(2^53 − 1) (HY-52)', 'invalid_number');
        }
        if (preg_match('/^[a-z][a-z0-9_-]*$/D', $name) !== 1 || str_starts_with($name, 'hy-')) {
            throw new HyperValueError("cookie name {$name} is not allowed (HY-52)", 'cookie_name_not_allowed');
        }
        if (preg_match('/^[A-Za-z0-9._~-]+$/D', $value) !== 1) {
            throw new HyperValueError(
                "cookie value of {$name} has a character that is not allowed (HY-52)",
                'cookie_value_not_allowed',
            );
        }
        if ($age !== null && $age < 0) {
            throw new HyperValueError("cookie {$name} has a negative Max-Age (HY-52)", 'negative_max_age');
        }
        $this->cookies[] = [$name, $value, $age];

        return $this;
    }

    /** Removes a cookie with Max-Age=0. */
    public function removeCookie(mixed $name): self
    {
        ArgumentCount::most(\func_num_args(), 1);
        $this->cookie($name, 'x');
        // The cookie that `cookie` checked and added holds the name as a string.
        $last = count($this->cookies) - 1;
        $this->cookies[$last] = [$this->cookies[$last][0], '', 0];

        return $this;
    }

    /**
     * Sets the Cache-Control of a page response with status 200. A page carries the session token of its visitor, so
     * the value keeps it out of shared caches: it has `private` or `no-store` and neither `public` nor `s-maxage`
     * (HY-52).
     */
    public function cacheControl(mixed $value): self
    {
        ArgumentCount::most(\func_num_args(), 1);
        if (!is_string($value)) {
            throw new HyperTypeError('a Cache-Control is not a string (HY-52)', 'invalid_argument_type');
        }
        $this->cacheControl = CoreRules::shared()->replyCacheControl($value);

        return $this;
    }

    /** Renews the session after the action of the request returns (HY-72). */
    public function renewSession(): self
    {
        ArgumentCount::most(\func_num_args(), 0);
        $this->renewal = true;

        return $this;
    }

    /**
     * Returns whether a renewal was requested since the last call, and clears the request.
     *
     * @internal
     */
    public function takeRenewal(): bool
    {
        $renewal = $this->renewal;
        $this->renewal = false;

        return $renewal;
    }

    /** @internal */
    public function cacheControlValue(): ?string
    {
        return $this->cacheControl;
    }

    /**
     * Sets the Referrer-Policy of the page and JSON answers of the request, whatever their status; a value that is not
     * a token of the Referrer-Policy specification fails (HY-103).
     */
    public function referrerPolicy(mixed $value): self
    {
        ArgumentCount::most(\func_num_args(), 1);
        if (!is_string($value)) {
            throw new HyperTypeError('a Referrer-Policy is not a string (HY-103)', 'invalid_argument_type');
        }
        $this->referrerPolicy = CoreRules::shared()->replyReferrerPolicy($value);

        return $this;
    }

    /** @internal */
    public function referrerPolicyValue(): ?string
    {
        return $this->referrerPolicy;
    }

    /**
     * @return array<string, string>
     *
     * @internal
     */
    public function referrerPolicyHeaders(): array
    {
        return $this->referrerPolicy === null ? [] : ['Referrer-Policy' => $this->referrerPolicy];
    }

    /**
     * Gives a page response that has status 200 otherwise the status 403, for a page that shows other data in place
     * of the data that the request may not see; another status fails (HY-69).
     */
    public function status(mixed $status): self
    {
        ArgumentCount::most(\func_num_args(), 1);
        $code = self::integer($status);
        if ($code === null) {
            throw new HyperValueError(
                'a page status of a reply is not an integer within ±(2^53 − 1) (HY-69)',
                'invalid_number',
            );
        }
        $this->status = CoreRules::shared()->replyStatus($code);

        return $this;
    }

    /** @internal */
    public function statusValue(): ?int
    {
        return $this->status;
    }

    /** Makes the HTML document of the response embed its data (HY-31, HY-92). */
    public function embedData(): self
    {
        ArgumentCount::most(\func_num_args(), 0);
        $this->embed = true;

        return $this;
    }

    /**
     * Returns whether the HTML document of the response embeds its data (HY-92).
     *
     * @internal
     */
    public function embedsData(): bool
    {
        return $this->embed;
    }

    /**
     * @return list<string>
     *
     * @internal
     */
    public function cookieHeaders(bool $secure): array
    {
        return array_map(
            static fn (array $cookie): string => "{$cookie[0]}={$cookie[1]}"
                . ($cookie[2] === null ? '' : "; Max-Age={$cookie[2]}") . '; Path=/'
                . ($secure ? '; Secure' : '') . '; HttpOnly; SameSite=Lax',
            $this->cookies,
        );
    }

    /**
     * Returns an integer of the data model, or null for another value: an int or a float within ±(2^53 − 1) without a
     * fraction, as Node takes a number (HY-44).
     */
    private static function integer(mixed $value): ?int
    {
        if (is_int($value)) {
            return $value >= -9007199254740991 && $value <= 9007199254740991 ? $value : null;
        }
        if (is_float($value) && is_finite($value) && floor($value) === $value && abs($value) <= 9007199254740991) {
            return (int) $value;
        }

        return null;
    }
}
