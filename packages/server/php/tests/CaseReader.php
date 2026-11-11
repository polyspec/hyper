<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use Polyspec\Hyper\Tests\Support\Json;
use Polyspec\Hyper\Tests\Support\Plain;

/**
 * One case of a file of contracts/, read through its declaration in contracts/interfaces.json `caseFiles` (HYR-4,
 * HYR-7). A step reads inputs and compares observed values only through this class; the case runner writes `line()`.
 */
final class CaseReader
{
    private const LANGUAGE = 'php';
    private const CONTRACTS = __DIR__ . '/../../../../contracts/';
    /** The keys of a case that are not fields of its section. */
    private const CASE_KEYS = ['id', 'label', 'only'];

    /** @var array<string, true> names read by the step, with their ancestors */
    private array $read = [];
    /** @var array<string, true> dotted field names compared by the step */
    private array $compared = [];
    /** @var array<string, true> outcome names compared by the step */
    private array $comparedOutcomes = [];
    private ?string $failure = null;
    private ?string $differs = null;

    /** @param array<string, mixed> $decl declaration of the section, with `fields`, `outcomes`, `uses` */
    private function __construct(
        private readonly string $file,
        private readonly string $section,
        private readonly \stdClass $case,
        private readonly array $decl,
        private readonly array $fixtures,
        private readonly \stdClass $data,
        private readonly ?string $error,
    ) {
    }

    /** @return list<string> the case files of contracts/interfaces.json */
    public static function files(): array
    {
        return array_keys(self::caseFiles());
    }

    /**
     * The readers of the cases of a file that this language runs, in file order. A file that is undeclared yields a
     * reader of every case of the file, each failing with `FILE_UNDECLARED <path>`.
     *
     * @return list<self>
     */
    public static function cases(string $file): array
    {
        $caseFiles = self::caseFiles();
        if (!array_key_exists($file, $caseFiles)) {
            throw new \LogicException("$file is not a case file of contracts/interfaces.json");
        }
        $decl = $caseFiles[$file];
        $fixtures = $decl['fixtures'] ?? [];
        $sections = $decl['sections'] ?? [];
        $data = Json::objectFile(self::CONTRACTS . $file);
        $error = self::undeclared($sections, $fixtures, $data);

        $readers = [];
        foreach (get_object_vars($data) as $key => $value) {
            if (array_key_exists($key, $fixtures)) {
                continue;
            }
            $section = $sections[$key] ?? null;
            if ($error === null && ($section === null || !in_array(self::LANGUAGE, $section['runners'], true))) {
                continue;
            }
            if (!is_array($value)) {
                continue;
            }
            foreach ($value as $case) {
                if (!$case instanceof \stdClass) {
                    continue;
                }
                if (isset($case->only) && !in_array(self::LANGUAGE, $case->only->languages ?? [], true)) {
                    continue;
                }
                $readers[] = new self($file, (string) $key, $case, $section ?? [], $fixtures, $data, $error);
            }
        }

        return $readers;
    }

    public function file(): string
    {
        return $this->file;
    }

    public function section(): string
    {
        return $this->section;
    }

    public function id(): string
    {
        return (string) ($this->case->id ?? '');
    }

    /** Whether the case has the field; the field is read. A field that another language only compares is absent. */
    public function has(string $name): bool
    {
        $field = $this->field($name);
        $this->read($name);

        return self::visible($field) && self::lookup($this->case, $name)[0];
    }

    /**
     * The value of an input of the case, or of a fixture named in `uses` (or of the file). An input of another
     * language's comparison is still given here: only the comparison is restricted by `only`.
     */
    public function input(string $name): mixed
    {
        $fields = $this->decl['fields'] ?? [];
        $fixture = !array_key_exists($name, $fields)
            && (array_key_exists($name, $this->fixtures) || in_array($name, $this->decl['uses'] ?? [], true));
        if ($fixture) {
            if (!property_exists($this->data, $name)) {
                throw new \LogicException("the file has no fixture $name");
            }
            $this->read($name);

            return Plain::value($this->data->$name);
        }

        $this->field($name);
        $this->read($name);
        [$found, $value] = self::lookup($this->case, $name);

        return $found ? Plain::value($value) : null;
    }

    /** Compares an observed value with the expected one of the case by the declared kind of the field. */
    public function compare(string $name, mixed $observed): void
    {
        $field = $this->field($name);
        $this->compared[$name] = true;
        if (!self::visible($field)) {
            return;
        }
        [$found, $expected] = self::lookup($this->case, $name);
        if (!$found) {
            return;
        }
        $kind = $field['compare'] ?? throw new \LogicException("$name declares no compare");
        if (!self::matches($kind, $expected, $observed, self::isHeaders($name))) {
            $this->differs ??= $name;
        }
    }

    /** Compares the observed outcome of a section with its declaration: the outcome is expected to hold. */
    public function outcome(string $name, mixed $observed): void
    {
        $outcome = $this->decl['outcomes'][$name] ?? throw new \LogicException("$name is no outcome of {$this->section}");
        $this->comparedOutcomes[$name] = true;
        if (!self::visible($outcome)) {
            return;
        }
        if (!self::matches($outcome['compare'], true, $observed, false)) {
            $this->differs ??= $name;
        }
    }

    /** Records an error that the step raised; a preset file error stays the reason. */
    public function fail(string $reason): void
    {
        $this->failure ??= 'CASE_ERROR ' . self::flat($reason);
    }

    /** The result line of the case. */
    public function line(): string
    {
        $head = "CASE {$this->file} {$this->id()}";
        $reason = $this->reason();

        return $reason === null ? "$head PASS" : "$head FAIL $reason";
    }

    private function reason(): ?string
    {
        if ($this->error !== null) {
            return self::flat($this->error);
        }
        if ($this->failure !== null) {
            return $this->failure;
        }
        if ($this->differs !== null) {
            return "FIELD_DIFFERS {$this->differs}";
        }
        $unknown = $this->unknown();
        if ($unknown !== null) {
            return "FIELD_UNKNOWN $unknown";
        }
        $uncompared = $this->uncompared();

        return $uncompared === null ? null : "FIELD_UNCOMPARED $uncompared";
    }

    /** The first visible input field of the case that no step has read. */
    private function unknown(): ?string
    {
        foreach ($this->decl['fields'] ?? [] as $name => $field) {
            if (($field['role'] ?? null) !== 'input' || !self::visible($field)) {
                continue;
            }
            if (self::lookup($this->case, (string) $name)[0] && !$this->covered((string) $name)) {
                return (string) $name;
            }
        }

        return null;
    }

    /** The first visible expected field, or outcome, of the case that no step has compared. */
    private function uncompared(): ?string
    {
        $path = self::uncomparedField($this->decl['fields'] ?? [], $this->case, '', $this->compared);
        if ($path !== null) {
            return $path;
        }
        foreach ($this->decl['outcomes'] ?? [] as $name => $outcome) {
            if (self::visible($outcome) && !isset($this->comparedOutcomes[$name])) {
                return (string) $name;
            }
        }

        return null;
    }

    /** @param array<string, true> $compared */
    private static function uncomparedField(array $fields, \stdClass $value, string $prefix, array $compared): ?string
    {
        foreach ($fields as $name => $field) {
            $path = $prefix === '' ? (string) $name : "$prefix.$name";
            if (($field['role'] ?? null) !== 'expected' || !self::visible($field) || !property_exists($value, (string) $name)) {
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

    /** Whether a step has read the input or one of its nested fields. */
    private function covered(string $name): bool
    {
        foreach (array_keys($this->read) as $read) {
            if ($read === $name || str_starts_with($read, "$name.")) {
                return true;
            }
        }

        return false;
    }

    /** @return array<string, mixed> the declaration of a dotted field name; undeclared names throw */
    private function field(string $name): array
    {
        $fields = $this->decl['fields'] ?? [];
        $field = null;
        foreach (explode('.', $name) as $part) {
            if (!array_key_exists($part, $fields)) {
                throw new \LogicException("$name is no declared field of {$this->section}");
            }
            $field = $fields[$part];
            $fields = $field['fields'] ?? [];
        }

        return $field;
    }

    private function read(string $name): void
    {
        $parts = explode('.', $name);
        foreach (array_keys($parts) as $index) {
            $this->read[implode('.', array_slice($parts, 0, $index + 1))] = true;
        }
    }

    /** @return array{0: bool, 1: mixed} whether the case holds the dotted name, and its value */
    private static function lookup(\stdClass $value, string $name): array
    {
        foreach (explode('.', $name) as $part) {
            if (!$value instanceof \stdClass || !property_exists($value, $part)) {
                return [false, null];
            }
            $value = $value->$part;
        }

        return [true, $value];
    }

    /** @param array<string, mixed> $declaration a field or an outcome */
    private static function visible(array $declaration): bool
    {
        $only = $declaration['only'] ?? null;

        return $only === null || in_array(self::LANGUAGE, $only['languages'] ?? [], true);
    }

    /** Header names compare without regard to ASCII case (HY-130). */
    private static function isHeaders(string $name): bool
    {
        $parts = explode('.', $name);

        return str_contains(strtolower(end($parts)), 'header');
    }

    private static function matches(string $kind, mixed $expected, mixed $observed, bool $ci): bool
    {
        return match ($kind) {
            'exact' => self::equal($expected, $observed, false, $ci),
            'ordered' => self::equal($expected, $observed, true, $ci),
            'subset' => self::subset($expected, $observed),
            'absent' => self::absent($expected, $observed),
            'contains' => self::contains($expected, $observed),
            'excludes' => !self::contains($expected, $observed) && self::none($expected, $observed),
            'prefix' => self::prefix($expected, $observed),
            'keys' => self::keys($expected, $observed),
            'raises' => $expected === $observed,
            default => throw new \LogicException("unknown compare kind $kind"),
        };
    }

    /**
     * Equal values: maps (objects) are distinct from lists; an empty array is a list, so it is not equal to an
     * object. Scalars compare by `===`, numbers by value.
     */
    private static function equal(mixed $expected, mixed $observed, bool $ordered, bool $ci): bool
    {
        if ($expected instanceof \stdClass) {
            $map = self::mapOf($observed, false);

            return $map !== null && self::mapEqual((array) $expected, $map, $ordered, $ci);
        }
        if (is_array($expected)) {
            if (!is_array($observed) || !array_is_list($observed) || count($expected) !== count($observed)) {
                return false;
            }
            foreach ($expected as $index => $value) {
                if (!self::equal($value, $observed[$index], $ordered, false)) {
                    return false;
                }
            }

            return true;
        }
        if ((is_int($expected) || is_float($expected)) && (is_int($observed) || is_float($observed))) {
            return $expected == $observed;
        }

        return $expected === $observed;
    }

    /** @param array<array-key, mixed> $expected @param array<array-key, mixed> $observed */
    private static function mapEqual(array $expected, array $observed, bool $ordered, bool $ci): bool
    {
        $expected = self::normalize($expected, $ci);
        $observed = self::normalize($observed, $ci);
        if (count($expected) !== count($observed)) {
            return false;
        }
        if ($ordered && array_keys($expected) !== array_keys($observed)) {
            return false;
        }
        foreach ($expected as $key => $value) {
            if (!array_key_exists($key, $observed) || !self::equal($value, $observed[$key], $ordered, false)) {
                return false;
            }
        }

        return true;
    }

    /** `subset`: each expected name is in the observed map with an equal value, names without regard to case. */
    private static function subset(mixed $expected, mixed $observed): bool
    {
        $have = self::mapOf($observed, true);
        if ($have === null) {
            return false;
        }
        $have = self::normalize($have, true);
        foreach ((array) $expected as $name => $value) {
            $key = strtolower((string) $name);
            if (!array_key_exists($key, $have) || !self::equal($value, $have[$key], false, false)) {
                return false;
            }
        }

        return true;
    }

    /** `absent`: no expected name is in the observed map, names without regard to case. */
    private static function absent(mixed $expected, mixed $observed): bool
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
    private static function contains(mixed $expected, mixed $observed): bool
    {
        foreach (self::needles($expected) as $needle) {
            if (!self::found($needle, $observed)) {
                return false;
            }
        }

        return true;
    }

    /** `excludes`: no expected substring (or item) is in the observed text (or list). */
    private static function none(mixed $expected, mixed $observed): bool
    {
        foreach (self::needles($expected) as $needle) {
            if (self::found($needle, $observed)) {
                return false;
            }
        }

        return true;
    }

    /** @return list<string> */
    private static function needles(mixed $expected): array
    {
        return is_string($expected) ? [$expected] : array_map(strval(...), (array) $expected);
    }

    private static function found(string $needle, mixed $observed): bool
    {
        if (is_string($observed)) {
            return str_contains($observed, $needle);
        }

        return is_array($observed) && in_array($needle, $observed, true);
    }

    /** `prefix`: the observed list starts with the expected items, each equal. */
    private static function prefix(mixed $expected, mixed $observed): bool
    {
        if (!is_array($observed) || !array_is_list($observed) || count($observed) < count($expected)) {
            return false;
        }
        foreach ($expected as $index => $value) {
            if (!self::equal($value, $observed[$index], true, false)) {
                return false;
            }
        }

        return true;
    }

    /** `keys`: the observed map has exactly the expected keys, in that order. */
    private static function keys(mixed $expected, mixed $observed): bool
    {
        $have = self::mapOf($observed, true) ?? [];

        return array_map(strval(...), array_keys($have)) === array_map(strval(...), (array) $expected);
    }

    /** The members of a map, or null for a value that is not a map. An empty array counts as a map only if asked. */
    private static function mapOf(mixed $value, bool $emptyIsMap): ?array
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
    private static function normalize(array $map, bool $ci): array
    {
        $out = [];
        foreach ($map as $key => $value) {
            $out[$ci ? strtolower((string) $key) : (string) $key] = $value;
        }

        return $out;
    }

    private static function flat(string $text): string
    {
        return str_replace(["\r\n", "\r", "\n"], ' ', $text);
    }

    /** @return array<string, array<string, mixed>> the `caseFiles` of contracts/interfaces.json */
    private static function caseFiles(): array
    {
        return Json::file(self::CONTRACTS . 'interfaces.json')['caseFiles'];
    }

    /**
     * The first key of the file, or of a case, that its declaration does not declare, or an expected field without
     * `fields` that has no compare, rule or quote.
     *
     * @param array<string, array<string, mixed>> $sections
     * @param array<string, mixed> $fixtures
     */
    private static function undeclared(array $sections, array $fixtures, \stdClass $data): ?string
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
            if (($field['role'] ?? null) === 'expected' && !isset($field['compare']) && !isset($field['rule']) && !isset($field['quote'])) {
                return $fieldPath;
            }
        }

        return null;
    }
}
