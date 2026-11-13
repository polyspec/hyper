<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The rules of the Rust core behind the names of the units of the PHP server (HY-132.2). The binding of the core gives
 * its rules as functions of one namespace, `Polyspec\Hyper` of the extension `polyspec_hyper`; this class takes that
 * namespace and gives each rule under the name of the unit of the server that states it today, the name of the unit
 * followed by the name of its member, so that a unit of the server calls the core in place of its own rule. A test
 * gives it the namespace of its stand-in functions.
 *
 * A unit is exact when the core decides everything that the unit of the server decides, and partial when the server
 * still does a part itself; each partial unit names that part by its rule. The members of the binding that take a
 * record (`routeRequest`, `computePageHeaders`, `openPage`, `answerKeepRequest`, `Pages` and `PageRequest`) have no
 * unit here.
 *
 * A failure of the core reaches the caller as the binding raises it: an error of the class of its category with
 * `kind()` and `status()` (HY-132.1, HY-132.2). No method here catches or replaces one.
 *
 * @internal
 */
final class CoreRules
{
    /** The functions of the binding that this class calls, which the constructor requires of the namespace. */
    public const array MEMBERS = [
        'csrfMask', 'csrfVerify', 'browser', 'storedToken', 'isApplicationPath', 'redirectLocation', 'cacheControl',
        'keepsOutOfSharedCaches', 'referrerPolicy', 'sessionName', 'keepName', 'sessionCookie', 'pageTag',
        'representationTag', 'pageStatus', 'replyStatus', 'pageVary', 'contextHash', 'currentPath', 'checkShellPath',
        'shellText', 'checkBuildId', 'readBuild', 'frameHeaders', 'keptValue', 'validContextHeader',
    ];

    private readonly string $namespace;

    /**
     * Takes the namespace of the functions of the binding. A namespace that lacks a function fails here with its name,
     * before a request calls it.
     */
    public function __construct(string $namespace)
    {
        $missing = array_values(array_filter(
            self::MEMBERS,
            static fn (string $name): bool => !function_exists($namespace . '\\' . $name),
        ));
        if ($missing !== []) {
            throw new \RuntimeException('hyper: the binding of the core has no member ' . implode(', ', $missing));
        }
        $this->namespace = $namespace;
    }

    /** Calls a function of the binding with the arguments. */
    private function call(string $name, mixed ...$arguments): mixed
    {
        return ($this->namespace . '\\' . $name)(...$arguments);
    }

    /** Csrf::mask: rules.csrf_mask (HY-24.2, HY-24.14). */
    public function csrfMask(string $token, string $mask): mixed
    {
        return $this->call('csrfMask', $token, $mask);
    }

    /** Csrf::verify: rules.csrf_verify (HY-24.4). */
    public function csrfVerify(string $token, string $value): mixed
    {
        return $this->call('csrfVerify', $token, $value);
    }

    /** Csrf::browserOf: rules.browser (HY-24.10, HY-24.13). */
    public function csrfBrowserOf(string $masked): mixed
    {
        return $this->call('browser', $masked);
    }

    /** Context::hash: rules.context_hash (HY-125.12). */
    public function contextHash(string $build, string $text): mixed
    {
        return $this->call('contextHash', $build, $text);
    }

    /** Context::validHeader: rules.valid_context_header (HY-127.2). */
    public function contextValidHeader(?string $value): mixed
    {
        return $this->call('validContextHeader', $value);
    }

    /** The name of the session cookie (HY-45.1), which NativeSession gives the session options: rules.session_name. */
    public function sessionCookieName(bool $secure): mixed
    {
        return $this->call('sessionName', $secure);
    }

    /** RepresentationResponse::etag: rules.representation_tag (HY-122.10, HY-122.11). */
    public function representationEtag(string $contentType, string $body): mixed
    {
        return $this->call('representationTag', $contentType, $body);
    }

    /** Request::currentPath: rules.current_path of the value of HX-Current-URL (HY-11.4). */
    public function requestCurrentPath(?string $header): mixed
    {
        return $this->call('currentPath', $header);
    }

    /** Reply::cacheControl: rules.cache_control gives the value that the reply keeps (HY-52.6). */
    public function replyCacheControl(string $value): mixed
    {
        return $this->call('cacheControl', $value);
    }

    /** Reply::referrerPolicy: rules.referrer_policy gives the value that the reply keeps (HY-103.2, HY-103.9). */
    public function replyReferrerPolicy(string $value): mixed
    {
        return $this->call('referrerPolicy', $value);
    }

    /** Reply::status: rules.reply_status gives the page status that the reply keeps (HY-69). */
    public function replyStatus(int $status): mixed
    {
        return $this->call('replyStatus', $status);
    }

    /** Result::redirect: rules.redirect_location gives the location of the result (HY-46). */
    public function resultRedirect(string $location): mixed
    {
        return $this->call('redirectLocation', $location);
    }

    /** Result::page: rules.page_status gives the status of the result (HY-58). */
    public function resultPage(int $status): mixed
    {
        return $this->call('pageStatus', $status);
    }

    /** App::varyHeader: rules.page_vary (HY-117.1). */
    public function appVaryHeader(bool $context): mixed
    {
        return $this->call('pageVary', $context);
    }

    /** The tag of a JSON response of Page::respond: rules.page_tag (HY-53.1). */
    public function pageTag(string $body, string $maskedToken, string $token): mixed
    {
        return $this->call('pageTag', $body, $maskedToken, $token);
    }

    /**
     * Partial. The field value of the session cookie: rules.session_cookie (HY-45.8). The server still starts the
     * session of PHP, which writes the cookie of a native session itself, and decides when a response sets the cookie
     * (HY-45.4).
     */
    public function sessionCookieHeader(string $id, bool $secure): mixed
    {
        return $this->call('sessionCookie', $id, $secure);
    }

    /**
     * Partial. rules.keeps_out_of_shared_caches (HY-52.6), which Reply::cacheControl decided inside its check; the
     * server reads it for no other rule.
     */
    public function replyKeepsOutOfSharedCaches(string $value): mixed
    {
        return $this->call('keepsOutOfSharedCaches', $value);
    }

    /**
     * Partial. rules.is_application_path (HY-46), the test inside Result::redirect; the server has no caller of it
     * besides the redirect.
     */
    public function resultIsApplicationPath(string $location): mixed
    {
        return $this->call('isApplicationPath', $location);
    }

    /**
     * Partial. The headers that every response carries: front_functions.frame_headers (HY-45.5, HY-65.1), as a map
     * from each name to its value in the order of the core. The server still adds them to its response, a header of
     * the same name replaced.
     *
     * @return array<string, string>
     */
    public function appFrameHeaders(int $status, string $frameAncestors): array
    {
        $headers = [];
        $pairs = $this->call('frameHeaders', $status, $frameAncestors);
        if (!is_iterable($pairs)) {
            throw new \RuntimeException('hyper: frameHeaders of the binding of the core gave no list of pairs');
        }
        foreach ($pairs as $pair) {
            if (!is_array($pair) || !is_string($pair[0] ?? null) || !is_string($pair[1] ?? null)) {
                throw new \RuntimeException('hyper: frameHeaders of the binding of the core gave no pair of texts');
            }
            $headers[$pair[0]] = $pair[1];
        }

        return $headers;
    }

    /**
     * Partial. The static shell of App::open: rules.check_shell_path checks its path before the server reads the file
     * (HY-62). The server still reads the file, and checks the data base path of the declaration against the routes
     * and the meta element of the shell (HY-62.2).
     */
    public function appCheckShellPath(string $path): void
    {
        $this->call('checkShellPath', $path);
    }

    /** Partial. rules.shell_text gives the text of the bytes of the static shell (HY-62), which the server read. */
    public function appShellText(string $path, string $bytes): mixed
    {
        return $this->call('shellText', $path, $bytes);
    }

    /**
     * Partial. The value check of the kept endpoint: front_functions.kept_value (HY-40.1). The server still checks the
     * token of the form (HY-24) and stores the value in the session.
     */
    public function appKeptValue(object $pages, string $region, string $path, string $text): mixed
    {
        return $this->call('keptValue', $pages, $region, $path, $text);
    }

    /**
     * Partial. Session::csrfToken: rules.stored_token checks the value that the session holds in the place of the
     * token (HY-24.14). The server still reads the store and creates the token of a session that holds none (HY-24.1).
     */
    public function sessionStoredToken(string $stored): mixed
    {
        return $this->call('storedToken', $stored);
    }

    /**
     * Partial. The name of the cookie of the kept values: rules.keep_name (HYC-13.6). The server still reads the
     * cookie from the request (HY-129).
     */
    public function keptCookieName(bool $secure): mixed
    {
        return $this->call('keepName', $secure);
    }

    /**
     * Partial. Build::read: rules.read_build gives the build id of the bytes of a `build.json` (HY-125.18, HY-125.19).
     * The server still reads the file and names the absolute path of the file in a failure (HY-125.18).
     */
    public function buildRead(string $bytes): mixed
    {
        return $this->call('readBuild', $bytes);
    }

    /** Partial. rules.check_build_id (HY-125.19), for a caller that holds a build id as text. */
    public function buildCheckId(string $text): void
    {
        $this->call('checkBuildId', $text);
    }
}
