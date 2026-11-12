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
    /** The fixed case files of tests/legacy, which a library holds now; the steps read them until S-4 removes the directory. */
    public const LEGACY = __DIR__ . '/../../../../../tests/legacy/';
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

    /** @return array<string, array<array-key, mixed>> the `caseFiles` of contracts/interfaces.json and of tests/legacy/interfaces.json */
    public static function caseFiles(): array
    {
        return [
            ...self::declarations(Json::file(self::CONTRACTS . 'interfaces.json')['caseFiles'] ?? null, 'caseFiles'),
            ...self::legacyCaseFiles(),
        ];
    }

    /** @return array<string, array<array-key, mixed>> the `caseFiles` of tests/legacy/interfaces.json, or none when the directory is gone */
    private static function legacyCaseFiles(): array
    {
        if (!is_file(self::LEGACY . 'interfaces.json')) {
            return [];
        }

        return self::declarations(Json::file(self::LEGACY . 'interfaces.json')['caseFiles'] ?? null, 'legacy caseFiles');
    }

    /** The path of a case file: under tests/legacy for a fixed case file, under contracts/ for every other one. */
    public static function caseFilePath(string $file): string
    {
        return (array_key_exists($file, self::legacyCaseFiles()) ? self::LEGACY : self::CONTRACTS) . $file;
    }

    /**
     * Returns a map of declarations, such as the fields of a section, each of them a map.
     *
     * @return array<string, array<array-key, mixed>>
     */
    public static function declarations(mixed $value, string $what): array
    {
        $declarations = [];
        foreach (Json::map($value, $what) as $name => $declaration) {
            $declarations[(string) $name] = Json::map($declaration, "{$what}.{$name}");
        }

        return $declarations;
    }

    /** @param array<array-key, mixed> $declaration a field or an outcome */
    public static function visible(array $declaration): bool
    {
        $only = $declaration['only'] ?? null;
        if ($only === null) {
            return true;
        }

        return in_array(self::LANGUAGE, Json::strings(Json::map($only, 'only')['languages'] ?? []), true);
    }

    /**
     * The comparison of a field: a response field has the comparison of its name (HYR-11).
     *
     * @param array<array-key, mixed> $field
     */
    public static function kind(array $field, string $name): string
    {
        if (($field['role'] ?? null) === 'response') {
            return self::RESPONSE_KINDS[$name] ?? throw new \LogicException("$name has no response comparison");
        }

        return Json::string($field['compare'] ?? throw new \LogicException("$name declares no compare"));
    }

    /** Header names compare without regard to ASCII case (HY-130). */
    public static function isHeaders(string $name): bool
    {
        $parts = explode('.', $name);

        return str_contains(strtolower(end($parts)), 'header');
    }

    /**
     * @param array<array-key, mixed> $fields
     * @return array<array-key, mixed> the declaration of a dotted field name; undeclared names throw
     */
    public static function field(array $fields, string $name, string $section): array
    {
        $field = [];
        foreach (explode('.', $name) as $part) {
            if (!array_key_exists($part, $fields)) {
                throw new \LogicException("$name is no declared field of $section");
            }
            $field = Json::map($fields[$part], $name);
            $fields = Json::map($field['fields'] ?? [], $name);
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
     * @param array<array-key, mixed> $decl
     * @param array<string, true> $read
     */
    public static function unknownInput(array $decl, \stdClass $case, array $read): ?string
    {
        foreach (self::declarations($decl['fields'] ?? [], 'fields') as $name => $field) {
            if (($field['role'] ?? null) !== 'input' || !self::visible($field)) {
                continue;
            }
            if (self::lookup($case, $name)[0] && !self::covered($read, $name)) {
                return $name;
            }
        }
        foreach (Json::strings($decl['uses'] ?? []) as $name) {
            if (!self::covered($read, $name)) {
                return $name;
            }
        }

        return null;
    }

    /**
     * The first visible expected field, or outcome, of the case that no step has compared.
     *
     * @param array<array-key, mixed> $decl
     * @param array<string, true> $compared
     * @param array<string, true> $comparedOutcomes
     */
    public static function uncompared(array $decl, \stdClass $case, array $compared, array $comparedOutcomes): ?string
    {
        $path = self::uncomparedField($decl['fields'] ?? [], $case, '', $compared);
        if ($path !== null) {
            return $path;
        }
        foreach (self::declarations($decl['outcomes'] ?? [], 'outcomes') as $name => $outcome) {
            if (self::visible($outcome) && !isset($comparedOutcomes[$name])) {
                return $name;
            }
        }

        return null;
    }

    /** @param array<string, true> $compared */
    private static function uncomparedField(mixed $fields, \stdClass $value, string $prefix, array $compared): ?string
    {
        foreach (self::declarations($fields, 'fields') as $name => $field) {
            $expected = ($field['role'] ?? null) === 'expected' && self::visible($field);
            if (!$expected || !property_exists($value, $name)) {
                continue;
            }
            $path = $prefix === '' ? $name : "$prefix.$name";
            $child = $value->$name;
            $inner = match (true) {
                !isset($field['fields']) => isset($compared[$path]) ? null : $path,
                $child instanceof \stdClass => self::uncomparedField($field['fields'], $child, $path, $compared),
                default => null,
            };
            if ($inner !== null) {
                return $inner;
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
        return is_string($expected) ? [$expected] : Json::strings($expected);
    }

    /** `absent`: no expected name is in the observed map, names without regard to case. */
    public static function absent(mixed $expected, mixed $observed): bool
    {
        $have = self::normalize(self::mapOf($observed, true) ?? [], true);
        foreach (Json::strings($expected) as $name) {
            if (array_key_exists(strtolower($name), $have)) {
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

        return array_map(strval(...), array_keys($have)) === Json::strings($expected);
    }

    /**
     * The members of a map, or null for a value that is not a map. An empty array counts as a map only if asked.
     *
     * @return ?array<array-key, mixed>
     */
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

    /**
     * @param array<array-key, mixed> $map
     * @return array<string, mixed>
     */
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
     * @param array<array-key, mixed> $sections
     * @param array<array-key, mixed> $fixtures
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
            $fields = Json::map($sections[$key], "the section {$key}")['fields'] ?? [];
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

    /** Returns the path of the first key of a value of a case that the fields do not declare, or null. */
    private static function unknownKey(mixed $value, mixed $fields, string $path, bool $case): ?string
    {
        $declared = self::declarations($fields, 'fields');
        foreach ($value instanceof \stdClass ? get_object_vars($value) : [] as $name => $child) {
            $known = array_key_exists($name, $declared) || ($case && in_array($name, self::CASE_KEYS, true));
            $inner = match (true) {
                !$known => "$path.$name",
                isset($declared[$name]['fields']) => self::unknownKey(
                    $child,
                    $declared[$name]['fields'],
                    "$path.$name",
                    false,
                ),
                default => null,
            };
            if ($inner !== null) {
                return $inner;
            }
        }

        return null;
    }

    /** Returns the path of the first expected field without `fields`, comparison and sentence, or null. */
    private static function undeclaredLeaf(mixed $fields, string $path): ?string
    {
        foreach (self::declarations($fields, 'fields') as $name => $field) {
            $stated = isset($field['compare']) || isset($field['sentence']);
            $inner = match (true) {
                isset($field['fields']) => self::undeclaredLeaf($field['fields'], "$path.$name.fields"),
                ($field['role'] ?? null) === 'expected' && !$stated => "$path.$name",
                default => null,
            };
            if ($inner !== null) {
                return $inner;
            }
        }

        return null;
    }
}
