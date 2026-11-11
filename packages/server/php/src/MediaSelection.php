<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The selection of the media type of a request among the page types and the representations of its route (HY-116,
 * HY-119), the list of the types that a path serves, and the Content-Type of a representation.
 *
 * @internal
 * @phpstan-import-type RepresentationEntry from RepresentationEntries
 */
final class MediaSelection
{
    private const TOKEN = '/\A[!#$%&\'*+\-.^_`|~0-9A-Za-z]+\z/';

    /**
     * Returns the type of the highest weight among the page types and the entries, with its entry and the values of
     * its required parameters for a representation, or null when no type has a weight above 0. Among equal weights
     * the first wins: the page types in their order, then the entries in declared order (HY-116.11). Throws
     * InvalidAccept as `Accept::parse` does.
     *
     * @param list<string> $pages
     * @param list<RepresentationEntry> $entries
     * @return ?array{0: string, 1: ?RepresentationEntry, 2: array<array-key, string>}
     *
     * @throws InvalidAccept
     */
    public static function select(?string $accept, array $pages, array $entries): ?array
    {
        $ranges = Accept::parse($accept);
        [$page, $best] = Accept::best($ranges, $pages);
        $selected = $page === null ? null : [$page, null, []];
        foreach ($entries as $entry) {
            [$weight, $values] = self::entryWeight($ranges, $entry);
            if ($weight > $best) {
                $selected = [$entry['media'], $entry, $values];
                $best = $weight;
            }
        }

        return $selected;
    }

    /**
     * Returns the weight in thousandths that the ranges give a declared type, and the parameter values of the range
     * that gives it: the highest weight, and the first in Accept order among equal ones, of the ranges that name the
     * type with a served value for every required parameter and no other parameter (HY-116.8, HY-119).
     *
     * @param list<MediaRange> $ranges
     * @param RepresentationEntry $entry
     * @return array{0: int, 1: array<array-key, string>}
     */
    public static function entryWeight(array $ranges, array $entry): array
    {
        $slash = (int) strpos($entry['media'], '/');
        $name = substr($entry['media'], 0, $slash);
        $subtype = substr($entry['media'], $slash + 1);
        $required = count($entry['parameters']);
        $weight = 0;
        $values = [];
        foreach ($ranges as $range) {
            if ($range->type !== $name || $range->subtype !== $subtype) {
                continue;
            }
            // A parameter that a range names twice has its last value.
            $given = [];
            foreach ($range->parameters as [$parameter, $value]) {
                $given[$parameter] = $value;
            }
            if (count($range->parameters) !== $required || count($given) !== $required) {
                continue;
            }
            $chosen = [];
            foreach ($entry['parameters'] as [$parameter, $served]) {
                if (array_key_exists($parameter, $given) && in_array($given[$parameter], $served, true)) {
                    $chosen[$parameter] = $given[$parameter];
                }
            }
            if (count($chosen) !== $required) {
                continue;
            }
            if ($range->weight > $weight) {
                $weight = $range->weight;
                $values = $chosen;
            }
        }

        return [$weight, $values];
    }

    /**
     * Returns the Content-Type of a representation: its type and, for each required parameter in declared order,
     * `; <name>=<value>` with the name in lower case and the value quoted when it is no token (HY-119.4).
     *
     * @param RepresentationEntry $entry
     * @param array<array-key, string> $values
     */
    public static function contentType(array $entry, array $values): string
    {
        $written = $entry['type'];
        foreach ($entry['parameters'] as [$parameter]) {
            $value = $values[$parameter]
                ?? throw new \LogicException("the selection has no value of the parameter {$parameter} (HY-119)");
            if (preg_match(self::TOKEN, $value) !== 1) {
                $value = '"' . str_replace(['\\', '"'], ['\\\\', '\\"'], $value) . '"';
            }
            $written .= "; {$parameter}={$value}";
        }

        return $written;
    }

    /**
     * Returns the types that a path serves, each on a line that ends with a line feed: the page types, then each
     * entry once for each combination of one served value of every required parameter, ordered by the values of the
     * first parameter, then of the next (HY-116.13).
     *
     * @param list<string> $pages
     * @param list<RepresentationEntry> $entries
     */
    public static function listing(array $pages, array $entries): string
    {
        $lines = $pages;
        foreach ($entries as $entry) {
            $combinations = [[]];
            foreach ($entry['parameters'] as [$parameter, $served]) {
                $next = [];
                foreach ($combinations as $combination) {
                    foreach ($served as $value) {
                        $next[] = $combination + [$parameter => $value];
                    }
                }
                $combinations = $next;
            }
            foreach ($combinations as $combination) {
                $lines[] = self::contentType($entry, $combination);
            }
        }
        $body = '';
        foreach ($lines as $line) {
            $body .= "{$line}\n";
        }

        return $body;
    }
}
