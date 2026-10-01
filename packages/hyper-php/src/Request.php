<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** One HTTP request with the session values that the application reads. */
final class Request
{
    /** @var array<string, string> */
    private readonly array $headers;

    /** The query values, or null when a name or a value is not UTF-8 (HY-42, HY-56). */
    private readonly ?Fields $queryFields;

    /**
     * @param array<string, string> $headers header names in any case
     * @param string $query the raw query: the request target after its first `?` up to its first `#`
     * @param array<string, mixed> $form
     * @param array<string, mixed> $flash
     * @param array<string, string> $params
     * @param array<string, string> $cookies
     */
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        array $headers = [],
        private readonly string $query = '',
        private readonly array $form = [],
        private readonly array $flash = [],
        private readonly string $csrfToken = '',
        private readonly array $params = [],
        private readonly array $cookies = [],
        public readonly bool $https = false,
    ) {
        $this->headers = array_change_key_case($headers, CASE_LOWER);
        $this->queryFields = Fields::parse($query);
    }

    /** Returns a copy that carries the flash values and the CSRF token of the session. */
    public function withSession(Flash $flash, string $csrfToken): self
    {
        return new self($this->method, $this->path, $this->headers, $this->query, $this->form, $flash->values, $csrfToken, $this->params, $this->cookies, $this->https);
    }

    /**
     * Returns a copy with the routed path (base path removed) and the route parameters.
     *
     * @param array<string, string> $params
     */
    public function withRoute(string $path, array $params): self
    {
        return new self($this->method, $path, $this->headers, $this->query, $this->form, $this->flash, $this->csrfToken, $params, $this->cookies, $this->https);
    }

    /**
     * Returns the route parameters.
     *
     * @return array<string, string>
     */
    public function params(): array
    {
        return $this->params;
    }

    /** Returns a cookie value, or null. */
    public function cookie(string $name): ?string
    {
        return $this->cookies[$name] ?? null;
    }

    /** Returns a route parameter, or null. */
    public function param(string $name): ?string
    {
        return $this->params[$name] ?? null;
    }

    /**
     * Returns true when the path consists of printable ASCII characters, every query name and value and every form
     * name and value at any depth and HX-Current-URL are valid UTF-8 (HY-42). Cookies are not checked; hyper ignores invalid ones.
     */
    public function validInput(): bool
    {
        return preg_match('/^[\x21-\x7E]*$/D', $this->path) === 1 && self::utf8($this->header('HX-Current-URL') ?? '') && $this->queryFields !== null && self::utf8Tree($this->form);
    }

    /** @param array<mixed> $values */
    private static function utf8Tree(array $values): bool
    {
        foreach ($values as $key => $value) {
            if (!self::utf8((string) $key) || (is_string($value) && !self::utf8($value)) || (is_array($value) && !self::utf8Tree($value))) {
                return false;
            }
        }

        return true;
    }

    private static function utf8(string $value): bool
    {
        return preg_match('//u', $value) === 1;
    }

    /** Returns the value of a header, or null. */
    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }

    /** Returns true when the request accepts JSON (HY-15). */
    public function wantsJson(): bool
    {
        return str_contains($this->header('Accept') ?? '', 'application/json');
    }

    /** Returns true for a region request: JSON from htmx, which sends HX-Request with every request (HY-15). */
    public function isRegionRequest(): bool
    {
        return $this->wantsJson() && $this->header('HX-Request') === 'true';
    }

    /** Returns the path of the page that sent the request, or null (HY-11). */
    public function currentPath(): ?string
    {
        $url = $this->header('HX-Current-URL');
        if ($url === null) {
            return null;
        }
        $path = parse_url($url, PHP_URL_PATH);

        return is_string($path) ? $path : null;
    }

    /** Returns the request path; after routing, the path without the base path. */
    public function path(): string
    {
        return $this->path;
    }

    /** Returns the raw query of the request target, or the empty string (HY-56). */
    public function rawQuery(): string
    {
        return $this->query;
    }

    /** Returns every query value in order, without nesting (HY-56). */
    public function query(): Fields
    {
        return $this->queryFields ?? Fields::empty();
    }

    /** Returns the last query value of a name as an integer, or the default when it is absent or not an integer. */
    public function queryInt(string $name, int $default): int
    {
        $value = $this->query()->last($name);
        if ($value !== null && preg_match('/^-?\d{1,15}$/', $value) === 1) {
            return (int) $value;
        }

        return $default;
    }

    /** Returns a form value as a string; an absent or non-string value is the empty string. */
    public function formString(string $name): string
    {
        $value = $this->form[$name] ?? '';

        return is_string($value) ? $value : '';
    }

    /** Returns a flash value stored by the previous action, or null. */
    public function flash(string $name): mixed
    {
        return $this->flash[$name] ?? null;
    }

    /** Returns the CSRF token of the session. */
    public function csrfToken(): string
    {
        return $this->csrfToken;
    }

    /**
     * Returns the path of a request target: the target before `?` or `#`, after the authority of an
     * absolute-form target, without decoding (HY-42).
     */
    public static function targetPath(string $target): string
    {
        $path = substr($target, 0, strcspn($target, '?#'));
        if (preg_match('#^[A-Za-z][A-Za-z0-9+.-]*://[^/]*#', $path, $authority) === 1) {
            $path = substr($path, strlen($authority[0]));
        }

        return $path === '' ? '/' : $path;
    }

    /** Returns the raw query of a request target: the target after its first `?` up to its first `#` (HY-56). */
    public static function targetQuery(string $target): string
    {
        $target = substr($target, 0, strcspn($target, '#'));
        $question = strpos($target, '?');

        return $question === false ? '' : substr($target, $question + 1);
    }

    /** Creates a request from the PHP request globals. */
    public static function fromGlobals(): self
    {
        $headers = [];
        foreach ($_SERVER as $key => $value) {
            if (is_string($value) && str_starts_with($key, 'HTTP_')) {
                $headers[str_replace('_', '-', substr($key, 5))] = $value;
            }
        }
        return new self(
            strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')),
            self::targetPath((string) ($_SERVER['REQUEST_URI'] ?? '/')),
            $headers,
            self::targetQuery((string) ($_SERVER['REQUEST_URI'] ?? '/')),
            $_POST,
            cookies: array_filter($_COOKIE, 'is_string'),
            https: ($_SERVER['HTTPS'] ?? '') !== '' && ($_SERVER['HTTPS'] ?? '') !== 'off',
        );
    }
}
