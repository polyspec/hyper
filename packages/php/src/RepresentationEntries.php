<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The representations of a route: the declaration of each entry and its manifest check (HY-2, HY-118), and the check
 * of the representation handlers that an application provides at open (HY-118).
 *
 * @internal
 */
final class RepresentationEntries
{
    private const TOKEN = '/\A[!#$%&\'*+\-.^_`|~0-9A-Za-z]+\z/';

    /**
     * The characters that a served value may hold: HTAB, SP and U+0021 to U+007E (HY-118.6), which are valid in a
     * quoted string (RFC 9110, section 5.6.4) and have the same bytes in UTF-8 and ISO-8859-1.
     */
    private const QUOTABLE = '/\A[\t \x21-\x7e]+\z/';

    private const METHODS = ['GET', 'POST', 'PUT', 'DELETE'];

    private const PAGE_TYPES = ['text/html', 'application/vnd.hyper+json'];

    private const REJECTED_VARY = ['accept', 'cookie'];

    /**
     * Returns the entries of a route in the order of the manifest, checked by HY-2 and HY-118: a duplicate type, a
     * page type, a wildcard, an invalid type, parameter or value, an empty method or value list, and an invalid vary
     * name fail the manifest. `$raw` is the value of `representations` of the route, decoded with `stdClass` for
     * objects, which tells an empty object from an empty array.
     *
     * @return list<RepresentationEntry>
     */
    public static function declare(string $route, mixed $raw): array
    {
        if (!is_array($raw)) {
            throw new \InvalidArgumentException('manifest representations is not a list');
        }
        $entries = [];
        $mediaTypes = [];
        foreach ($raw as $item) {
            if (!$item instanceof \stdClass) {
                throw new \InvalidArgumentException('manifest representations contains a value that is not an object');
            }
            $entry = self::entry($route, $item);
            if (in_array($entry->media, $mediaTypes, true)) {
                throw new \InvalidArgumentException("route {$route} declares the type {$entry->type} twice (HY-118)");
            }
            $mediaTypes[] = $entry->media;
            $entries[] = $entry;
        }

        return $entries;
    }

    /**
     * Fails the open when an entry has no handler or a handler is keyed by a type that the route does not declare;
     * the keys compare exactly as the manifest writes them (HY-118).
     *
     * @param list<RepresentationEntry> $entries
     * @param array<array-key, mixed> $handlers
     */
    public static function checkHandlers(string $route, array $entries, array $handlers): void
    {
        $declared = array_map(static fn (RepresentationEntry $entry): string => $entry->type, $entries);
        foreach ($declared as $type) {
            if (!array_key_exists($type, $handlers)) {
                throw new \InvalidArgumentException(
                    "route {$route} has no representation handler for {$type} (HY-118)",
                );
            }
        }
        foreach (array_keys($handlers) as $type) {
            if (!in_array((string) $type, $declared, true)) {
                throw new \InvalidArgumentException(
                    "route {$route} has a representation handler for {$type}, which the route does not declare "
                    . '(HY-118)',
                );
            }
        }
    }

    private static function entry(string $route, \stdClass $item): RepresentationEntry
    {
        foreach (['type', 'parameters', 'methods', 'vary'] as $key) {
            if (!property_exists($item, $key)) {
                throw new \InvalidArgumentException("route {$route} has a representation without {$key} (HY-118)");
            }
        }
        $kind = $item->type;
        if (!is_string($kind)) {
            throw new \InvalidArgumentException("route {$route} has a representation type that is not text (HY-118)");
        }
        // The type and the subtype are tokens as the manifest writes them, so that lower case changes only ASCII
        // letters.
        $slash = strpos($kind, '/');
        $main = $slash === false ? '' : substr($kind, 0, $slash);
        $sub = $slash === false ? '' : substr($kind, $slash + 1);
        $media = strtolower($kind);
        if (
            $slash === false
            || preg_match(self::TOKEN, $main) !== 1
            || preg_match(self::TOKEN, $sub) !== 1
            || $main === '*'
            || $sub === '*'
            || in_array($media, self::PAGE_TYPES, true)
        ) {
            throw new \InvalidArgumentException("route {$route} has the invalid representation type {$kind} (HY-118)");
        }

        return new RepresentationEntry(
            $kind,
            $media,
            self::servedParameters($route, $kind, $item->parameters),
            self::answeredMethods($route, $kind, $item->methods),
            self::varyNames($route, $kind, $item->vary),
        );
    }

    /** @return list<array{0: string, 1: list<string>}> */
    private static function servedParameters(string $route, string $kind, mixed $raw): array
    {
        if (!$raw instanceof \stdClass) {
            throw new \InvalidArgumentException(
                "route {$route} has parameters of {$kind} that are not an object (HY-118)",
            );
        }
        $parameters = [];
        $names = [];
        foreach (get_object_vars($raw) as $key => $values) {
            // PHP gives a decimal name as an integer key; the name is its string.
            $name = (string) $key;
            $lower = strtolower($name);
            if (preg_match(self::TOKEN, $name) !== 1 || $lower === 'q' || in_array($lower, $names, true)) {
                throw new \InvalidArgumentException(
                    "route {$route} has the invalid parameter {$name} of {$kind} (HY-118)",
                );
            }
            $names[] = $lower;
            if (!is_array($values) || $values === []) {
                throw new \InvalidArgumentException(
                    "route {$route} has no served value for {$name} of {$kind} (HY-118)",
                );
            }
            $served = [];
            foreach ($values as $value) {
                if (
                    !is_string($value)
                    || (preg_match(self::TOKEN, $value) !== 1 && preg_match(self::QUOTABLE, $value) !== 1)
                ) {
                    throw new \InvalidArgumentException(
                        "route {$route} has the invalid value of {$name} of {$kind} (HY-118)",
                    );
                }
                $served[] = $value;
            }
            $parameters[] = [$lower, $served];
        }

        return $parameters;
    }

    /** @return list<string> */
    private static function answeredMethods(string $route, string $kind, mixed $raw): array
    {
        $methods = [];
        foreach (is_array($raw) ? $raw : [] as $method) {
            if (is_string($method) && in_array($method, self::METHODS, true)) {
                $methods[] = $method;
            }
        }
        if (!is_array($raw) || $methods === [] || count($methods) !== count($raw)) {
            throw new \InvalidArgumentException(
                "route {$route} has methods of {$kind} that are not a nonempty subset of GET, POST, PUT, DELETE "
                . '(HY-118)',
            );
        }

        return $methods;
    }

    /** @return list<string> */
    private static function varyNames(string $route, string $kind, mixed $raw): array
    {
        if (!is_array($raw)) {
            throw new \InvalidArgumentException(
                "route {$route} has vary names of {$kind} that are not a list (HY-118)",
            );
        }
        $names = [];
        foreach ($raw as $name) {
            if (!is_string($name) || preg_match(self::TOKEN, $name) !== 1) {
                throw new \InvalidArgumentException(
                    "route {$route} has a vary name of {$kind} that is not a field name (HY-118)",
                );
            }
            $lower = strtolower($name);
            $repeated = in_array($lower, array_map(strtolower(...), $names), true);
            if ($repeated || in_array($lower, self::REJECTED_VARY, true)) {
                throw new \InvalidArgumentException(
                    "route {$route} has the vary name {$name} of {$kind} that is rejected or repeated (HY-118)",
                );
            }
            $names[] = $name;
        }

        return $names;
    }
}
