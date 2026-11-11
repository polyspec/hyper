<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

/**
 * The rules that CaseReader applies to one case of a case file (HYR-7, HYR-11): the declaration checks, the field
 * lookups, the unread and uncompared fields, and the comparisons that do not compare two values by equality.
 */
final class CaseRules
{
    public const LANGUAGE = 'php';
    public const CONTRACTS = __DIR__ . '/../../../../../contracts/';
    /** The keys of a case that are not fields of its section. */
    public const CASE_KEYS = ['id', 'label', 'only', 'requirements'];
    /** HYR-11: the comparison of a response field, by its name. */
    public const RESPONSE_KINDS = [
        'status' => 'exact',
        'body' => 'exact',
        'headers' => 'subset',
        'allHeaders' => 'exact',
        'absentHeaders' => 'absent',
        'bodyContains' => 'contains',
        'bodyNotContains' => 'excludes',
    ];

    /** @return array<string, array<string, mixed>> the `caseFiles` of contracts/interfaces.json */
    public static function caseFiles(): array
    {
        return Json::file(self::CONTRACTS . 'interfaces.json')['caseFiles'];
    }

    /** @param array<string, mixed> $declaration a field or an outcome */
    public static function visible(array $declaration): bool
    {
        $only = $declaration['only'] ?? null;

        return $only === null || in_array(self::LANGUAGE, $only['languages'] ?? [], true);
    }

    /** The comparison of a field: a response field has the comparison of its name (HYR-11). */
    public static function kind(array $field, string $name): string
    {
        if (($field['role'] ?? null) === 'response') {
            return self::RESPONSE_KINDS[$name] ?? throw new \LogicException("$name has no response comparison");
        }

        return $field['compare'] ?? throw new \LogicException("$name declares no compare");
    }

    /** Header names compare without regard to ASCII case (HY-130). */
    public static function isHeaders(string $name): bool
    {
        $parts = explode('.', $name);

        return str_contains(strtolower(end($parts)), 'header');
    }

    /** @return array<string, mixed> the declaration of a dotted field name; undeclared names throw */
    public static function field(array $fields, string $name, string $section): array
    {
        $field = null;
        foreach (explode('.', $name) as $part) {
            if (!array_key_exists($part, $fields)) {
                throw new \LogicException("$name is no declared field of $section");
            }
            $field = $fields[$part];
            $fields = $field['fields'] ?? [];
        }

        return $field;
    }

    /** @return list<string> the dotted names of a name and of its ancestors */
    public static function ancestors(string $name): array
    {
        $parts = explode('.', $name);
        $names = [];
        foreach (array_keys($parts) as $index) {
            $names[] = implode('.', array_slice($parts, 0, $index + 1));
        }

        return $names;
    }

    /** @return array{0: bool, 1: mixed} whether the case holds the dotted name, and its value */
    public static function lookup(\stdClass $value, string $name): array
    {
        foreach (explode('.', $name) as $part) {
            if (!$value instanceof \stdClass || !property_exists($value, $part)) {
                return [false, null];
            }
            $value = $value->$part;
        }

        return [true, $value];
    }

    /** @param array<string, true> $read */
    public static function covered(array $read, string $name): bool
    {
        foreach (array_keys($read) as $covered) {
            if ($covered === $name || str_starts_with($covered, "$name.")) {
                return true;
            }
        }

        return false;
    }

    /**
     * The first visible input field of the case, or used fixture, that no step has read.
     *
     * @param array<string, mixed> $decl
     * @param array<string, true> $read
     */
    public static function unknownInput(array $decl, \stdClass $case, array $read): ?string
    {
        foreach ($decl['fields'] ?? [] as $name => $field) {
            if (($field['role'] ?? null) !== 'input' || !self::visible($field)) {
                continue;
            }
            if (self::lookup($case, (string) $name)[0] && !self::covered($read, (string) $name)) {
                return (string) $name;
            }
        }
        foreach ($decl['uses'] ?? [] as $name) {
            if (!self::covered($read, $name)) {
                return $name;
            }
        }

        return null;
    }

    /**
     * The first visible expected field, or outcome, of the case that no step has compared.
     *
     * @param array<string, mixed> $decl
     * @param array<string, true> $compared
     * @param array<string, true> $comparedOutcomes
     */
    public static function uncompared(array $decl, \stdClass $case, array $compared, array $comparedOutcomes): ?string
    {
        $path = self::uncomparedField($decl['fields'] ?? [], $case, '', $compared);
        if ($path !== null) {
            return $path;
        }
        foreach ($decl['outcomes'] ?? [] as $name => $outcome) {
            if (self::visible($outcome) && !isset($comparedOutcomes[$name])) {
                return (string) $name;
            }
        }

        return null;
    }

    /** @param array<string, array<string, mixed>> $fields @param array<string, true> $compared */
    private static function uncomparedField(array $fields, \stdClass $value, string $prefix, array $compared): ?string
    {
        foreach ($fields as $name => $field) {
            $path = $prefix === '' ? (string) $name : "$prefix.$name";
            $present = property_exists($value, (string) $name);
            if (($field['role'] ?? null) !== 'expected' || !self::visible($field) || !$present) {
                continue;
            }
            if (isset($field['fields'])) {
                $child = $value->$name;
                if ($child instanceof \stdClass) {
                    $inner = self::uncomparedField($field['fields'], $child, $path, $compared);
                    if ($inner !== null) {
                        return $inner;
                    }
                }
                continue;
            }
            if (!isset($compared[$path])) {
                return $path;
            }
        }

        return null;
    }

    /** HYR-11: the error that a step raises is the open error of HY-106 when its class is exactly that error. */
    public static function openError(mixed $observed): bool
    {
        return $observed instanceof \Throwable && $observed::class === \InvalidArgumentException::class;
    }

    /** @return list<string> */
    public static function needles(mixed $expected): array
    {
        return is_string($expected) ? [$expected] : array_map(strval(...), (array) $expected);
    }

    /** `absent`: no expected name is in the observed map, names without regard to case. */
    public static function absent(mixed $expected, mixed $observed): bool
    {
        $have = self::normalize(self::mapOf($observed, true) ?? [], true);
        foreach ($expected as $name) {
            if (array_key_exists(strtolower((string) $name), $have)) {
                return false;
            }
        }

        return true;
    }

    /** `contains`: every expected substring (or item) is in the observed text (or list). */
    public static function contains(mixed $expected, mixed $observed): bool
    {
        foreach (self::needles($expected) as $needle) {
            if (!self::found($needle, $observed)) {
                return false;
            }
        }

        return true;
    }

    /** `excludes`: no expected substring (or item) is in the observed text (or list). */
    public static function none(mixed $expected, mixed $observed): bool
    {
        foreach (self::needles($expected) as $needle) {
            if (self::found($needle, $observed)) {
                return false;
            }
        }

        return true;
    }

    private static function found(string $needle, mixed $observed): bool
    {
        if (is_string($observed)) {
            return str_contains($observed, $needle);
        }

        return is_array($observed) && in_array($needle, $observed, true);
    }

    /** `keys`: the observed map has exactly the expected keys, in that order. */
    public static function keys(mixed $expected, mixed $observed): bool
    {
        $have = self::mapOf($observed, true) ?? [];

        return array_map(strval(...), array_keys($have)) === array_map(strval(...), (array) $expected);
    }

    /** The members of a map, or null for a value that is not a map. An empty array counts as a map only if asked. */
    public static function mapOf(mixed $value, bool $emptyIsMap): ?array
    {
        if ($value instanceof \stdClass) {
            return (array) $value;
        }
        if (!is_array($value)) {
            return null;
        }
        if ($value === []) {
            return $emptyIsMap ? [] : null;
        }

        return array_is_list($value) ? null : $value;
    }

    /** @param array<array-key, mixed> $map @return array<string, mixed> */
    public static function normalize(array $map, bool $ci): array
    {
        $out = [];
        foreach ($map as $key => $value) {
            $out[$ci ? strtolower((string) $key) : (string) $key] = $value;
        }

        return $out;
    }

    public static function flat(string $text): string
    {
        return str_replace(["\r\n", "\r", "\n"], ' ', $text);
    }

    /**
     * The first key of the file, or of a case, that its declaration does not declare, or an expected field without
     * `fields` that has no comparison or sentence.
     *
     * @param array<string, array<string, mixed>> $sections
     * @param array<string, mixed> $fixtures
     */
    public static function undeclared(array $sections, array $fixtures, \stdClass $data): ?string
    {
        foreach (get_object_vars($data) as $key => $value) {
            if (array_key_exists($key, $fixtures)) {
                continue;
            }
            if (!array_key_exists($key, $sections) || !is_array($value)) {
                return "FILE_UNDECLARED $key";
            }
            $fields = $sections[$key]['fields'] ?? [];
            foreach ($value as $index => $case) {
                $path = self::unknownKey($case, $fields, "$key.$index", true);
                if ($path !== null) {
                    return "FILE_UNDECLARED $path";
                }
            }
            $leaf = self::undeclaredLeaf($fields, "$key.fields");
            if ($leaf !== null) {
                return "FILE_UNDECLARED $leaf";
            }
        }

        return null;
    }

    /** @param array<string, array<string, mixed>> $fields */
    private static function unknownKey(mixed $value, array $fields, string $path, bool $case): ?string
    {
        if (!$value instanceof \stdClass) {
            return null;
        }
        foreach (get_object_vars($value) as $name => $child) {
            $name = (string) $name;
            $childPath = "$path.$name";
            if (!array_key_exists($name, $fields) && !($case && in_array($name, self::CASE_KEYS, true))) {
                return $childPath;
            }
            if (isset($fields[$name]['fields'])) {
                $inner = self::unknownKey($child, $fields[$name]['fields'], $childPath, false);
                if ($inner !== null) {
                    return $inner;
                }
            }
        }

        return null;
    }

    /** @param array<string, array<string, mixed>> $fields */
    private static function undeclaredLeaf(array $fields, string $path): ?string
    {
        foreach ($fields as $name => $field) {
            $fieldPath = "$path.$name";
            if (isset($field['fields'])) {
                $inner = self::undeclaredLeaf($field['fields'], "$fieldPath.fields");
                if ($inner !== null) {
                    return $inner;
                }
                continue;
            }
            if (($field['role'] ?? null) === 'expected' && !isset($field['compare']) && !isset($field['sentence'])) {
                return $fieldPath;
            }
        }

        return null;
    }
}
