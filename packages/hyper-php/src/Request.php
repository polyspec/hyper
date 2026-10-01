<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** One HTTP request with the session values that the application reads. */
final class Request
{
    /** @var array<string, string> */
    private readonly array $headers;

    /**
     * @param array<string, string> $headers header names in any case
     * @param array<string, mixed> $query
     * @param array<string, mixed> $form
     * @param array<string, mixed> $flash
     * @param array<string, string> $params
     * @param array<string, string> $cookies
     */
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        array $headers = [],
        private readonly array $query = [],
        private readonly array $form = [],
        private readonly array $flash = [],
        private readonly string $csrfToken = '',
        private readonly array $params = [],
        private readonly array $cookies = [],
    ) {
        $this->headers = array_change_key_case($headers, CASE_LOWER);
    }

    /** Returns a copy that carries the flash values and the CSRF token of the session. */
    public function withSession(Flash $flash, string $csrfToken): self
    {
        return new self($this->method, $this->path, $this->headers, $this->query, $this->form, $flash->values, $csrfToken, $this->params, $this->cookies);
    }

    /**
     * Returns a copy with the routed path (base path removed) and the route parameters.
     *
     * @param array<string, string> $params
     */
    public function withRoute(string $path, array $params): self
    {
        return new self($this->method, $path, $this->headers, $this->query, $this->form, $this->flash, $this->csrfToken, $params, $this->cookies);
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

    /** Returns the region named by the Hy-Region header, or null for a document request (HY-15). */
    public function region(): ?string
    {
        return $this->header('Hy-Region');
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

    /** Returns a query value as an integer, or the default when it is absent or not an integer. */
    public function queryInt(string $name, int $default): int
    {
        $value = $this->query[$name] ?? null;
        if (is_string($value) && preg_match('/^-?\d{1,15}$/', $value) === 1) {
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

    /** Creates a request from the PHP request globals. */
    public static function fromGlobals(): self
    {
        $headers = [];
        foreach ($_SERVER as $key => $value) {
            if (is_string($value) && str_starts_with($key, 'HTTP_')) {
                $headers[str_replace('_', '-', substr($key, 5))] = $value;
            }
        }
        $path = parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);

        return new self(
            strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')),
            is_string($path) && $path !== '' ? $path : '/',
            $headers,
            $_GET,
            $_POST,
            cookies: array_filter($_COOKIE, 'is_string'),
        );
    }
}
