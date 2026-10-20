<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** One HTTP response. */
final class Response
{
    /** @param array<string, string|list<string>> $headers `Set-Cookie` holds a list; every other header holds one value */
    public function __construct(
        public readonly int $status,
        public readonly array $headers,
        public readonly string $body,
    ) {
    }

    /** Returns a copy with one more header. */
    public function withHeader(string $name, string $value): self
    {
        return new self($this->status, [...$this->headers, $name => $value], $this->body);
    }

    /**
     * Returns a copy with the cookies of a reply, when it has any (HY-52).
     *
     * @internal
     */
    public function withCookies(Reply $reply, bool $secure): self
    {
        $cookies = $reply->cookieHeaders($secure);

        return $cookies === [] ? $this : new self(
            $this->status,
            [...$this->headers, 'Set-Cookie' => $cookies],
            $this->body,
        );
    }

    /** Returns a plain text response. */
    public static function text(int $status, string $body): self
    {
        return new self($status, ['Content-Type' => 'text/plain; charset=utf-8'], $body);
    }

    /**
     * Writes the status, the headers and the body to the PHP output.
     *
     * @internal
     */
    public function send(): void
    {
        http_response_code($this->status);
        $this->writeHeaders();
        echo $this->body;
    }

    /**
     * Writes this response in place of a failed one (HY-60): the queued headers are dropped, then the `$kept` header
     * lines of the caller are added again, and the status line is set with header(), because a fatal error makes PHP
     * queue its own status line, which http_response_code() refuses to replace. `$statusLine` is the whole status line,
     * such as `HTTP/1.1 500 Internal Server Error`.
     *
     * @param list<string> $kept
     *
     * @internal
     */
    public function sendReplacing(array $kept, string $statusLine): void
    {
        header_remove();
        foreach ($kept as $line) {
            header($line, false);
        }
        header($statusLine, true, $this->status);
        $this->writeHeaders();
        echo $this->body;
    }

    /** Adds the headers of this response to the PHP output, each value as a line of its own. */
    private function writeHeaders(): void
    {
        foreach ($this->headers as $name => $value) {
            foreach ((array) $value as $item) {
                header("{$name}: {$item}", false);
            }
        }
    }
}
