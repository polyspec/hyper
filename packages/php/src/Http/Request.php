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

    /** The form values of the body, or null when a name or a value is not UTF-8 (HY-42, HY-57). */
    private readonly ?Fields $formFields;

    /** The file parts of the body, or null when a name, a filename or a content type is not UTF-8 (HY-42, HY-113). */
    private readonly ?Files $fileParts;

    /** True for a multipart type without a boundary, or with an empty one, as the core reads it (HY-113.24). */
    private readonly bool $noBoundary;

    /** The reader of the body of a request as received, which `withInput` feeds; null in every other request (HY-60.18). */
    private ?BodyReader $unread = null;

    /**
     * @param array<string, string> $headers header names in any case
     * @param string $query the raw query: the request target after its first `?` up to its first `#`
     * @param string $body the request body, whose form values the request reads (HY-57)
     * @param array<array-key, mixed> $flash
     * @param array<string, string> $params
     * @param array<array-key, string> $cookies cookie values by name; PHP gives a decimal name as an integer key
     * @param ?int $bodySize the size of the body that the host received, when it stopped reading a body larger than
     *     the limit (HY-59); null counts the body itself
     * @param ?BodyReader $read the body as a host read it: a body read in chunks gives its parts (HY-131)
     * @param mixed $json the decoded JSON body of a representation request (HY-121), which the server gives
     */
    public function __construct(
        public readonly string $method,
        private readonly string $path,
        array $headers = [],
        private readonly string $query = '',
        private readonly string $body = '',
        private readonly array $flash = [],
        private readonly string $csrfToken = '',
        private readonly array $params = [],
        private readonly array $cookies = [],
        public readonly bool $https = false,
        private readonly mixed $selection = null,
        private readonly ?int $bodySize = null,
        private readonly ?string $media = null,
        private readonly ?BodyReader $read = null,
        private readonly mixed $json = null,
    ) {
        ArgumentCount::most(\func_num_args(), 15);
        $this->headers = array_change_key_case($headers, CASE_LOWER);
        $this->queryFields = Fields::parse($query);
        // The core reads the body (H35.11): the parts of a body that its host read in chunks, or the form of a body
        // that is one value, which fails as a whole (HY-113.23, HY-113.25).
        [$parts, $this->noBoundary] = $read !== null && $read->streamed()
            ? [$read->parts(), false]
            : self::heldForm($this->header('Content-Type') ?? '', $body);
        $this->formFields = $parts[0] ?? null;
        $this->fileParts = $parts[1] ?? null;
    }

    /**
     * Returns the fields and the files of a body held as one value, read by `readHeldBody` of the core without a limit,
     * or null when a part fails with `invalid` or `header_limit` (HY-42, HY-113.23, HY-113.25), and whether its type is
     * a `multipart/form-data` type without a boundary, or with an empty one, which the route refuses (HY-113.24). A
     * content type that is no media type, and a multipart type without a boundary, give no field and no file, because
     * the `Content-Type` is judged after the route (HY-57.15, HY-59.12).
     *
     * @return array{0: array{0: Fields, 1: Files}|null, 1: bool}
     */
    private static function heldForm(string $type, string $body): array
    {
        $none = BodyReader::limits(PHP_INT_MAX, PHP_INT_MAX, PHP_INT_MAX, PHP_INT_MAX);
        try {
            return [BodyReader::named(readHeldBody($type === '' ? null : $type, $body, ...$none)), false];
        } catch (HyperValueError $error) {
            if (in_array($error->kind(), ['malformed_content_type', 'no_boundary'], true)) {
                return [[Fields::empty(), Files::empty()], $error->kind() === 'no_boundary'];
            }

            return [null, false];
        }
    }

    /**
     * Returns true when the body passed the value limit, the part limit or the file limit (HY-131.32), as the core
     * decides it: as its host read it, or for a body that is one value by `readHeldBody`, with the part limit and the
     * file limit when `$streams` tells that the application reads a multipart body in chunks.
     *
     * @internal
     */
    public function exceeded(int $valueLimit, int $partLimit, int $fileLimit, bool $streams): bool
    {
        if ($this->read !== null && ($this->read->exceeded() || $this->read->streamed())) {
            return $this->read->exceeded();
        }
        $limits = BodyReader::limits(
            PHP_INT_MAX,
            $valueLimit,
            $streams ? $partLimit : PHP_INT_MAX,
            $streams ? $fileLimit : PHP_INT_MAX,
        );
        $type = $this->header('Content-Type') ?? '';
        try {
            readHeldBody($type === '' ? null : $type, $this->body, ...$limits);
        } catch (HyperValueError $error) {
            return BodyReader::overLimit($error);
        }

        return false;
    }

    /**
     * Removes the directory of the files of the body with the files that were not moved (HY-131.14).
     *
     * @internal
     */
    public function release(): void
    {
        ($this->read ?? $this->unread)?->remove();
    }

    /**
     * Returns a copy that carries the flash values and the CSRF token of the session.
     *
     * @internal
     */
    public function withSession(Flash $flash, string $csrfToken): self
    {
        return $this->copy(['flash' => $flash->values, 'csrfToken' => $csrfToken]);
    }

    /**
     * Returns a copy with the routed path (base path removed) and the route parameters.
     *
     * @param array<string, string> $params
     *
     * @internal
     */
    public function withRoute(string $path, array $params): self
    {
        return $this->copy(['path' => $path, 'params' => $params]);
    }

    /**
     * Returns a copy whose header of the name, compared without case as `header` reads it, has the value (HY-97).
     */
    public function withHeader(string $name, string $value): self
    {
        ArgumentCount::most(\func_num_args(), 2);
        return $this->copy(['headers' => [...$this->headers, strtolower($name) => $value]]);
    }

    /**
     * Returns a copy that carries the media type that the request selected (HY-116).
     *
     * @internal
     */
    public function withMedia(string $type): self
    {
        return $this->copy(['media' => $type]);
    }

    /**
     * Returns the request that a representation handler receives: without the Cookie header and the cookies, and
     * with the decoded JSON value of its body (HY-121).
     *
     * @internal
     */
    public function asRepresentation(mixed $value): self
    {
        $headers = $this->headers;
        unset($headers['cookie']);

        return $this->copy(['headers' => $headers, 'cookies' => [], 'json' => $value]);
    }

    /**
     * Returns a copy with the method GET, as which the server answers a HEAD request (HY-27.4).
     *
     * @internal
     */
    public function asGet(): self
    {
        return $this->copy(['method' => 'GET']);
    }

    /**
     * Returns the bytes of the body as the host gave them.
     *
     * @internal
     */
    public function bodyBytes(): string
    {
        return $this->body;
    }

    /**
     * Returns the value of the JSON body of a representation request, or null for a request without a body
     * (HY-121.9). The value has the form of the JSON reader of the core (JsonCodec::decode): a list
     * is an array with sequence keys, an object a `stdClass` or an array whose keys are not a sequence, a number a
     * float.
     */
    public function json(): mixed
    {
        ArgumentCount::most(\func_num_args(), 0);
        return $this->json;
    }

    /**
     * Returns a copy that carries the value of the choice of the client rendering selection (HY-62).
     *
     * @internal
     */
    public function withSelection(mixed $value): self
    {
        return $this->copy(['selection' => $value]);
    }

    /**
     * Returns a copy of this request with the given constructor arguments replaced.
     *
     * @param array{
     *     flash?: array<array-key, mixed>,
     *     csrfToken?: string,
     *     path?: string,
     *     params?: array<string, string>,
     *     headers?: array<string, string>,
     *     selection?: mixed,
     *     media?: string,
     *     method?: string,
     *     cookies?: array<array-key, string>,
     *     json?: mixed
     * } $changes
     */
    private function copy(array $changes): self
    {
        return new self(...[
            'method' => $this->method,
            'path' => $this->path,
            'headers' => $this->headers,
            'query' => $this->query,
            'body' => $this->body,
            'flash' => $this->flash,
            'csrfToken' => $this->csrfToken,
            'params' => $this->params,
            'cookies' => $this->cookies,
            'https' => $this->https,
            'selection' => $this->selection,
            'bodySize' => $this->bodySize,
            'media' => $this->media,
            'read' => $this->read,
            'json' => $this->json,
            ...$changes,
        ]);
    }

    /**
     * Returns the value of the choice that the client rendering selection returned for this request, or null for an
     * application without client rendering (HY-62).
     */
    public function selection(): mixed
    {
        ArgumentCount::most(\func_num_args(), 0);
        return $this->selection;
    }

    /**
     * Returns the route parameters.
     *
     * @return array<string, string>
     */
    public function params(): array
    {
        ArgumentCount::most(\func_num_args(), 0);
        return $this->params;
    }

    /** Returns a cookie value, or null. */
    public function cookie(string $name): ?string
    {
        ArgumentCount::most(\func_num_args(), 1);
        return $this->cookies[$name] ?? null;
    }

    /** Returns a route parameter, or null. */
    public function param(string $name): ?string
    {
        ArgumentCount::most(\func_num_args(), 1);
        return $this->params[$name] ?? null;
    }

    /**
     * Returns true when the path consists of printable ASCII characters and every query and form name and value
     * and HX-Current-URL are valid UTF-8 (HY-42). Cookies are not checked; hyper ignores invalid ones.
     */
    public function validInput(): bool
    {
        ArgumentCount::most(\func_num_args(), 0);
        return preg_match('/^[\x21-\x7E]*$/D', $this->path) === 1
            && self::validUtf8($this->header('HX-Current-URL') ?? '')
            && $this->queryFields !== null
            && $this->formFields !== null
            && $this->fileParts !== null;
    }

    private static function validUtf8(string $value): bool
    {
        return preg_match('//u', $value) === 1;
    }

    /**
     * Returns the size of the body in bytes: its length, or the Content-Length header when that is larger, because
     * PHP leaves the body empty when it is larger than post_max_size (HY-59).
     */
    public function bodySize(): int
    {
        ArgumentCount::most(\func_num_args(), 0);
        $declared = $this->header('Content-Length') ?? '';

        return max(
            $this->bodySize ?? strlen($this->body),
            $this->read?->size() ?? 0,
            preg_match('/^\d+$/D', $declared) === 1 ? (int) $declared : 0,
        );
    }

    /**
     * Returns the media type of the Content-Type header in lower case, without its parameters, as the core reads it,
     * or the empty text without the header (HY-59.13).
     *
     * @throws HyperValueError With kind `malformed_content_type` (status 400) for a Content-Type that is no media type.
     */
    public function mediaType(): string
    {
        ArgumentCount::most(\func_num_args(), 0);
        $type = $this->header('Content-Type');

        return $type === null ? '' : CoreRules::shared()->requestMediaType($type);
    }

    /**
     * Returns true when the Content-Type is a `multipart/form-data` type without a boundary, or with an empty one, as
     * the core reads it (HY-113.24): the body was held as bytes and fails no reading, and the route judges the type.
     *
     * @internal
     */
    public function boundaryMissing(): bool
    {
        return $this->noBoundary;
    }

    /** Returns the value of a header, or null. */
    public function header(string $name): ?string
    {
        ArgumentCount::most(\func_num_args(), 1);
        return $this->headers[strtolower($name)] ?? null;
    }

    /**
     * Returns true when the selected media type of the request is application/vnd.hyper+json (HY-15, HY-116). The
     * selection is read from the request and Accept is not read again; a request without a selection fails.
     */
    public function wantsJson(): bool
    {
        ArgumentCount::most(\func_num_args(), 0);
        if ($this->media === null) {
            throw new \LogicException('the request holds no selected media type (HY-116)');
        }

        return $this->media === 'application/vnd.hyper+json';
    }

    /** Returns true for a region request: JSON from htmx, which sends HX-Request with every request (HY-15). */
    public function isRegionRequest(): bool
    {
        ArgumentCount::most(\func_num_args(), 0);
        return $this->wantsJson() && $this->header('HX-Request') === 'true';
    }

    /**
     * Returns the path of the page that sent the request, or null: rules.current_path of the core of the value of
     * HX-Current-URL (HY-11.5).
     */
    public function currentPath(): ?string
    {
        ArgumentCount::most(\func_num_args(), 0);
        return CoreRules::shared()->requestCurrentPath($this->header('HX-Current-URL'));
    }

    /** Returns the request path; after routing, the path without the base path. */
    public function path(): string
    {
        ArgumentCount::most(\func_num_args(), 0);
        return $this->path;
    }

    /** Returns the raw query of the request target, or the empty string (HY-56). */
    public function rawQuery(): string
    {
        ArgumentCount::most(\func_num_args(), 0);
        return $this->query;
    }

    /**
     * Returns every query value without nesting, as pairs of a name and its values in request order, in the order of
     * the first value of each name (HY-56).
     *
     * @return list<array{string, list<string>}>
     */
    public function query(): array
    {
        ArgumentCount::most(\func_num_args(), 0);
        return ($this->queryFields ?? Fields::empty())->pairs();
    }

    /** Returns the last query value of a name as an integer, or the default when it is absent or not an integer. */
    public function queryInt(string $name, int $default): int
    {
        ArgumentCount::most(\func_num_args(), 2);
        $value = $this->queryFields?->last($name);
        if ($value !== null && preg_match('/^-?\d{1,15}$/D', $value) === 1) {
            return (int) $value;
        }

        return $default;
    }

    /**
     * Returns every form value of the body without nesting, as pairs of a name and its values in request order, in
     * the order of the first value of each name (HY-57).
     *
     * @return list<array{string, list<string>}>
     */
    public function form(): array
    {
        ArgumentCount::most(\func_num_args(), 0);
        return ($this->formFields ?? Fields::empty())->pairs();
    }

    /** Returns the last form value of a name; an absent name gives the empty string. */
    public function formString(string $name): string
    {
        ArgumentCount::most(\func_num_args(), 1);
        return $this->formFields?->last($name) ?? '';
    }

    /**
     * Returns the file parts of the body as pairs of a name and its files in request order, in the order of the first
     * file of each name (HY-113).
     *
     * @return list<array{string, list<UploadedFile>}>
     */
    public function files(): array
    {
        ArgumentCount::most(\func_num_args(), 0);
        return ($this->fileParts ?? Files::empty())->pairs();
    }

    /** Returns the last file of a name, or null (HY-113). */
    public function file(string $name): ?UploadedFile
    {
        ArgumentCount::most(\func_num_args(), 1);
        return $this->fileParts?->last($name);
    }

    /**
     * Returns true when a file of the body is larger than `$limit` bytes (HY-114), as rules.file_over of the core
     * decides it. A limit that is no unsigned integer fails with `invalid_number` before the files are compared
     * (HY-114.12).
     */
    public function fileOver(int $limit): bool
    {
        ArgumentCount::most(\func_num_args(), 1);
        return CoreRules::shared()->requestFileOver($this->fileParts?->sizes() ?? [], $limit);
    }

    /** Returns a flash value stored by the previous action, or null. */
    public function flash(string $name): mixed
    {
        ArgumentCount::most(\func_num_args(), 1);
        return $this->flash[$name] ?? null;
    }

    /** Returns the CSRF token of the session. */
    public function csrfToken(): string
    {
        ArgumentCount::most(\func_num_args(), 0);
        return $this->csrfToken;
    }

    /**
     * Returns the digest of the session token, which names the browser of the request, or null for a request
     * without a session (HY-24.10).
     */
    public function browser(): ?string
    {
        ArgumentCount::most(\func_num_args(), 0);
        return Csrf::browserOf($this->csrfToken);
    }

    /**
     * Returns the path of a request target: the target before `?` or `#`, after the authority of an
     * absolute-form target, without decoding (HY-42).
     */
    public static function targetPath(string $target): string
    {
        ArgumentCount::most(\func_num_args(), 1);
        $path = substr($target, 0, strcspn($target, '?#'));
        if (preg_match('#^[A-Za-z][A-Za-z0-9+.-]*://[^/]*#', $path, $authority) === 1) {
            $path = substr($path, strlen($authority[0]));
        }

        return $path === '' ? '/' : $path;
    }

    /** Returns the raw query of a request target: the target after its first `?` up to its first `#` (HY-56). */
    public static function targetQuery(string $target): string
    {
        ArgumentCount::most(\func_num_args(), 1);
        $target = substr($target, 0, strcspn($target, '#'));
        $question = strpos($target, '?');

        return $question === false ? '' : substr($target, $question + 1);
    }

    /**
     * Creates the request as received from the PHP request globals, with an empty body (HY-60.18), and the reader of
     * its body, which `withInput` feeds in chunks up to the body limit `$limit`, and a multipart body through the
     * reader of HY-131 when `$stream` is true, with the limits of HY-131.7 to HY-131.12.
     *
     * @internal
     */
    public static function received(
        int $limit = PHP_INT_MAX,
        bool $stream = false,
        int $valueLimit = PHP_INT_MAX,
        int $partLimit = PHP_INT_MAX,
        int $fileLimit = PHP_INT_MAX,
    ): self {
        $headers = [];
        foreach ($_SERVER as $key => $value) {
            if (is_string($value) && str_starts_with($key, 'HTTP_')) {
                $headers[str_replace('_', '-', substr($key, 5))] = $value;
            }
        }
        // PHP gives these two request headers without the HTTP_ prefix.
        foreach (['CONTENT_TYPE' => 'Content-Type', 'CONTENT_LENGTH' => 'Content-Length'] as $key => $name) {
            if (is_string($_SERVER[$key] ?? null)) {
                $headers[$name] = $_SERVER[$key];
            }
        }
        // HY-100.31: the host passes the method in upper case.
        $method = $_SERVER['REQUEST_METHOD'] ?? null;
        $method = is_string($method) ? strtoupper($method) : $method;
        // HY-100.2: a request whose target the SAPI does not give is answered with the plain 500 and not as the
        // request of the path `/`, which would be the answer to another request. The error escapes `run` before a
        // request exists, so no write hook is called for it (HY-99.12).
        $target = $_SERVER['REQUEST_URI'] ?? null;
        if (!is_string($target)) {
            throw new \RuntimeException(
                'hyper: $_SERVER has no REQUEST_URI, so the request target is unknown (HY-100)',
            );
        }

        // HY-60.18: the request as received has an empty body whose size is the declared Content-Length.
        $declared = $headers['Content-Length'] ?? null;
        $received = new self(
            strtoupper(is_string($method) ? $method : 'GET'),
            self::targetPath($target),
            $headers,
            self::targetQuery($target),
            // HY-129: the one parse of the header, which PHP gives as it received it in $_SERVER.
            cookies: Cookies::parse(is_string($_SERVER['HTTP_COOKIE'] ?? null) ? $_SERVER['HTTP_COOKIE'] : null),
            https: ($_SERVER['HTTPS'] ?? '') !== '' && ($_SERVER['HTTPS'] ?? '') !== 'off',
            bodySize: $declared !== null && ctype_digit($declared) ? (int) $declared : null,
        );
        // The core reads the body (H35.11) and fails a Content-Length that is no number or above the body limit before
        // any byte is read (HY-131.29).
        $received->unread = new BodyReader(
            $headers['Content-Type'] ?? '',
            $limit,
            $stream,
            $valueLimit,
            $partLimit,
            $fileLimit,
            $declared,
        );

        return $received;
    }

    /**
     * Creates a request from the PHP request globals and reads its body, as `received` and `withInput` do.
     *
     * @internal
     */
    public static function fromGlobals(
        int $limit = PHP_INT_MAX,
        bool $stream = false,
        int $valueLimit = PHP_INT_MAX,
        int $partLimit = PHP_INT_MAX,
        int $fileLimit = PHP_INT_MAX,
    ): self {
        return self::received($limit, $stream, $valueLimit, $partLimit, $fileLimit)->withInput();
    }

    /**
     * Returns the request of this request as received with the body that `$source` gives, `php://input` by default,
     * read in chunks through the reader of the request as received. A read of the source that fails raises, so the
     * failure is an escaped error answered with the plain 500 and not a shortened body (HY-60.14). The files of the
     * body stay in the directory that `release` of this request as received removes (HY-131.14).
     *
     * @internal
     */
    public function withInput(string $source = 'php://input'): self
    {
        $read = $this->unread;
        if ($read === null) {
            throw new \LogicException('hyper: only a request as received reads its body');
        }
        // The raw body, not $_POST, which nests bracketed names. PHP gives the body of a multipart/form-data request
        // here only when enable_post_data_reading is off, and holds what was read in a temporary file of its own.
        $input = fopen($source, 'rb');
        if ($input === false) {
            throw new \RuntimeException("hyper: cannot open {$source}");
        }
        try {
            while (!feof($input)) {
                $chunk = fread($input, 65536);
                if ($chunk === false) {
                    throw new \RuntimeException("hyper: the read of {$source} failed (HY-60)");
                }
                // A reader that holds the limit takes no more of the body (HY-59).
                if (!$read->feed($chunk)) {
                    break;
                }
            }
        } finally {
            fclose($input);
        }
        $read->finish();

        return new self(
            $this->method,
            $this->path,
            $this->headers,
            $this->query,
            $read->held(),
            cookies: $this->cookies,
            https: $this->https,
            read: $read,
        );
    }
}
