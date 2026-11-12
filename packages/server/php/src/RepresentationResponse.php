<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server;

/**
 * The response of a representation request (HY-122): the checks of what a handler returned, its headers, its body as
 * the JSON text of HY-54 and its strong tag.
 *
 * @internal
 */
final class RepresentationResponse
{
    private const STATUSES = [200, 201, 204, 400, 401, 403, 404, 406, 409, 412, 415, 422, 428];

    private const ALLOWED = ['location', 'www-authenticate', 'cache-control'];

    /** An absolute URI starts with a scheme and a colon (RFC 3986, section 4.3). */
    private const ABSOLUTE = '/\A[A-Za-z][A-Za-z0-9+.\-]*:/';

    /**
     * Returns the response of what a handler returned, with the Content-Type of its type, Vary and its Cache-Control;
     * throws for a value, a status, a header or a body that HY-122 does not allow, which answers the 500 of HY-43.
     */
    public static function of(
        mixed $returned,
        string $contentType,
        string $vary,
        bool $authorized,
        string $basePath,
    ): Response {
        if (!$returned instanceof Representation) {
            throw new \LogicException('a representation handler returned no Representation (HY-122)');
        }
        $status = $returned->status;
        if (!in_array($status, self::STATUSES, true)) {
            throw new \LogicException("a representation handler returned the status {$status} (HY-122)");
        }
        $given = [];
        foreach ($returned->headers as $name => $value) {
            $given[strtolower((string) $name)] = $value;
        }
        foreach (array_keys($given) as $name) {
            if (!in_array($name, self::ALLOWED, true)) {
                throw new \LogicException("a representation handler set the header {$name} (HY-122)");
            }
        }
        if ($status === 401 && !array_key_exists('www-authenticate', $given)) {
            throw new \LogicException('a 401 of a representation has no WWW-Authenticate (HY-122)');
        }
        if ($status === 201 && !array_key_exists('location', $given)) {
            throw new \LogicException('a 201 of a representation has no Location (HY-122)');
        }
        if ($status === 204 && $returned->body !== null) {
            throw new \LogicException('a 204 of a representation has a body (HY-122)');
        }
        if ($status === 200 && $returned->body === null) {
            throw new \LogicException('a 200 of a representation has no body (HY-122)');
        }
        $headers = [];
        $body = '';
        if ($returned->body !== null) {
            $body = JsonCodec::encode($returned->body);
            $headers['Content-Type'] = $contentType;
        }
        $headers['Cache-Control'] = self::cachePolicy($status, $given['cache-control'] ?? null, $authorized);
        $headers['Vary'] = $vary;
        if (array_key_exists('location', $given)) {
            $headers['Location'] = self::sentLocation($given['location'], $basePath);
        }
        if (array_key_exists('www-authenticate', $given)) {
            if (!is_string($given['www-authenticate'])) {
                throw new \LogicException('a WWW-Authenticate of a representation is not a string (HY-122)');
            }
            $headers['WWW-Authenticate'] = $given['www-authenticate'];
        }

        return new Response($status, $headers, $body);
    }

    /**
     * Returns the strong tag of a body of a type: the first 32 hexadecimal digits of the SHA-256 digest of the
     * Content-Type, a line feed and the body, in quotes (HY-122.10).
     */
    public static function etag(string $contentType, string $body): string
    {
        return '"' . substr(hash('sha256', "{$contentType}\n{$body}"), 0, 32) . '"';
    }

    /**
     * Returns the Cache-Control of a response: `no-store` for a status of 400 or more, which a handler must not set,
     * the value of the handler, which a request with Authorization keeps out of shared caches, or the default
     * (HY-122.6, HY-122.7).
     */
    private static function cachePolicy(int $status, mixed $given, bool $authorized): string
    {
        if ($status >= 400) {
            if ($given !== null) {
                throw new \LogicException("a representation handler set Cache-Control on a {$status} (HY-122)");
            }

            return 'no-store';
        }
        if ($given === null) {
            return $authorized ? 'private, no-cache' : 'no-cache';
        }
        if (!is_string($given)) {
            throw new \LogicException('a Cache-Control of a representation is not a string (HY-122)');
        }
        $directives = array_map(
            static fn (string $item): string => strtolower(trim(explode('=', $item, 2)[0], " \t")),
            explode(',', $given),
        );
        $shared = in_array('public', $directives, true) || in_array('s-maxage', $directives, true);
        $kept = in_array('private', $directives, true) || in_array('no-store', $directives, true);
        if ($authorized && ($shared || !$kept)) {
            throw new \LogicException(
                'a Cache-Control of a representation lets a shared cache store the response of a request with '
                . 'Authorization (HY-122)',
            );
        }

        return $given;
    }

    /**
     * Returns the Location of a response: an absolute URI as it is, and an application path with the base path of
     * the request; another value fails (HY-122.5).
     */
    private static function sentLocation(mixed $location, string $basePath): string
    {
        if (!is_string($location)) {
            throw new \LogicException('a Location of a representation is not a string (HY-122)');
        }
        if (preg_match(self::ABSOLUTE, $location) === 1) {
            return $location;
        }
        // Result::redirect checks that the location is an application path (HY-46).
        Result::redirect($location);

        return $basePath . $location;
    }
}
