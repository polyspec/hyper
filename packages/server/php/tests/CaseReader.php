<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use Polyspec\Hyper\Tests\Support\CaseRules;
use Polyspec\Hyper\Tests\Support\Json;
use Polyspec\Hyper\Tests\Support\Plain;

/**
 * One case of a file of contracts/, read through its declaration in contracts/interfaces.json `caseFiles` (HYR-4,
 * HYR-7). A step reads inputs and compares observed values only through this class; the case runner writes `line()`.
 * The rules that apply to a case are in CaseRules.
 */
final class CaseReader
{
    /** @var array<string, true> names read by the step, with their ancestors */
    private array $read = [];
    /** @var array<string, true> dotted field names compared by the step */
    private array $compared = [];
    /** @var array<string, true> outcome names compared by the step */
    private array $comparedOutcomes = [];
    /** the comparisons that the step made, for CASE_EMPTY */
    private int $checks = 0;
    private ?string $failure = null;
    private ?string $differs = null;

    /**
     * @param array<array-key, mixed> $decl declaration of the section, with `fields`, `outcomes`, `uses`
     * @param array<array-key, mixed> $fixtures the fixtures of the file by their names
     */
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

    /**
     * The readers of the cases of a file that this language runs, in file order. A file that is undeclared yields a
     * reader of every case of the file, each failing with `FILE_UNDECLARED <path>`.
     *
     * @return list<self>
     */
    public static function cases(string $file): array
    {
        $decl = self::declaration($file);
        $fixtures = Json::map($decl['fixtures'] ?? [], 'fixtures');
        $sections = CaseRules::declarations($decl['sections'] ?? [], 'sections');
        $data = Json::objectFile(CaseRules::CONTRACTS . $file);
        $error = CaseRules::undeclared($sections, $fixtures, $data);

        $readers = [];
        foreach (get_object_vars($data) as $key => $value) {
            if (array_key_exists($key, $fixtures)) {
                continue;
            }
            $section = $sections[$key] ?? null;
            $runs = $section !== null && in_array(CaseRules::LANGUAGE, Json::strings($section['runners'] ?? []), true);
            if ($error === null && !$runs) {
                continue;
            }
            if (!is_array($value)) {
                continue;
            }
            foreach ($value as $case) {
                if (!$case instanceof \stdClass) {
                    continue;
                }
                $only = $case->only ?? null;
                $languages = $only === null
                    ? [CaseRules::LANGUAGE]
                    : Json::strings(Json::object($only)->languages ?? []);
                if (!in_array(CaseRules::LANGUAGE, $languages, true)) {
                    continue;
                }
                $readers[] = new self($file, (string) $key, $case, $section ?? [], $fixtures, $data, $error);
            }
        }

        return $readers;
    }

    public function section(): string
    {
        return $this->section;
    }

    public function id(): string
    {
        return Json::string($this->case->id ?? '');
    }

    /** Whether the case has the field; the field is read. A field that another language only compares is absent. */
    public function has(string $name): bool
    {
        $field = CaseRules::field(Json::map($this->decl['fields'] ?? [], 'fields'), $name, $this->section);
        foreach (CaseRules::ancestors($name) as $read) {
            $this->read[$read] = true;
        }

        return CaseRules::visible($field) && CaseRules::lookup($this->case, $name)[0];
    }

    /**
     * The value of an input of the case, or of a fixture named in `uses` (or of the file). An input of another
     * language's comparison is still given here: only the comparison is restricted by `only`.
     */
    public function input(string $name): mixed
    {
        $fields = Json::map($this->decl['fields'] ?? [], 'fields');
        $uses = Json::strings($this->decl['uses'] ?? []);
        $fixture = !array_key_exists($name, $fields)
            && (array_key_exists($name, $this->fixtures) || in_array($name, $uses, true));
        if ($fixture) {
            if (!property_exists($this->data, $name)) {
                throw new \LogicException("the file has no fixture $name");
            }
            foreach (CaseRules::ancestors($name) as $read) {
                $this->read[$read] = true;
            }

            return Plain::value($this->data->$name);
        }

        CaseRules::field($fields, $name, $this->section);
        foreach (CaseRules::ancestors($name) as $read) {
            $this->read[$read] = true;
        }
        [$found, $value] = CaseRules::lookup($this->case, $name);

        return $found ? Plain::value($value) : null;
    }

    /** Compares an observed value with the expected one of the case by the kind of the field (HYR-11). */
    public function compare(string $name, mixed $observed): void
    {
        $field = CaseRules::field(Json::map($this->decl['fields'] ?? [], 'fields'), $name, $this->section);
        if (!CaseRules::visible($field)) {
            $this->compared[$name] = true;

            return;
        }
        [$found, $expected] = CaseRules::lookup($this->case, $name);
        if (!$found) {
            // A field that the case does not hold is an error of the case unless its declaration is optional.
            if (($field['optional'] ?? false) !== true) {
                throw new \LogicException("the case has no field {$name}");
            }

            return;
        }
        $this->compared[$name] = true;
        $this->checks++;
        if (!self::matches(CaseRules::kind($field, $name), $expected, $observed, CaseRules::isHeaders($name))) {
            $this->differs ??= $name;
        }
    }

    /**
     * Compares an outcome of the section (HYR-11): `raises` takes the error that the step caught, or null, and expects
     * the value true by default; `exact` compares the observed value with the expected one that the step gives.
     */
    public function outcome(string $name, mixed $observed, mixed $expected = true): void
    {
        $outcome = Json::map(
            Json::map($this->decl['outcomes'] ?? [], 'outcomes')[$name]
                ?? throw new \LogicException("$name is no outcome of {$this->section}"),
            "the outcome {$name}",
        );
        $this->comparedOutcomes[$name] = true;
        if (!CaseRules::visible($outcome)) {
            return;
        }
        $this->checks++;
        if (!self::matches(Json::string($outcome['compare'] ?? null), $expected, $observed, false)) {
            $this->differs ??= $name;
        }
    }

    /** Records an error that the step raised; a preset file error stays the reason. */
    public function fail(string $reason): void
    {
        $this->failure ??= 'CASE_ERROR ' . CaseRules::flat($reason);
    }

    /** The result line of the case: the first reason that applies, in the order of HYR-7. */
    public function line(): string
    {
        $head = "CASE {$this->file} {$this->id()}";
        if ($this->error !== null) {
            return "$head FAIL " . CaseRules::flat($this->error);
        }
        if ($this->failure !== null) {
            return "$head FAIL {$this->failure}";
        }
        if ($this->checks === 0) {
            return "$head FAIL CASE_EMPTY";
        }
        if ($this->differs !== null) {
            return "$head FAIL FIELD_DIFFERS {$this->differs}";
        }
        $unknown = CaseRules::unknownInput($this->decl, $this->case, $this->read);
        if ($unknown !== null) {
            return "$head FAIL FIELD_UNKNOWN $unknown";
        }
        $uncompared = CaseRules::uncompared($this->decl, $this->case, $this->compared, $this->comparedOutcomes);

        return $uncompared === null ? "$head PASS" : "$head FAIL FIELD_UNCOMPARED $uncompared";
    }

    /** @return array<array-key, mixed> the declaration of a case file of contracts/interfaces.json */
    private static function declaration(string $file): array
    {
        $caseFiles = CaseRules::caseFiles();
        if (!array_key_exists($file, $caseFiles)) {
            throw new \LogicException("$file is not a case file of contracts/interfaces.json");
        }

        return $caseFiles[$file];
    }

    private static function matches(string $kind, mixed $expected, mixed $observed, bool $ci): bool
    {
        return match ($kind) {
            'exact' => self::equal($expected, $observed, false, $ci),
            'ordered' => self::equal($expected, $observed, true, $ci),
            'subset' => (static function () use ($expected, $observed): bool {
                $have = CaseRules::mapOf($observed, true);
                if ($have === null) {
                    return false;
                }
                $have = CaseRules::normalize($have, true);
                foreach ((array) $expected as $name => $value) {
                    $key = strtolower((string) $name);
                    if (!array_key_exists($key, $have) || !self::equal($value, $have[$key], false, false)) {
                        return false;
                    }
                }

                return true;
            })(),
            'absent' => CaseRules::absent($expected, $observed),
            'contains' => CaseRules::contains($expected, $observed),
            'excludes' => !CaseRules::contains($expected, $observed) && CaseRules::none($expected, $observed),
            'prefix' => (static function () use ($expected, $observed): bool {
                $expected = Json::list($expected);
                if (!is_array($observed) || !array_is_list($observed) || count($observed) < count($expected)) {
                    return false;
                }
                foreach ($expected as $index => $value) {
                    if (!self::equal($value, $observed[$index], true, false)) {
                        return false;
                    }
                }

                return true;
            })(),
            'keys' => CaseRules::keys($expected, $observed),
            'raises' => $expected === true ? CaseRules::openError($observed) : $observed === null,
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
            $map = CaseRules::mapOf($observed, false);
            if ($map === null) {
                return false;
            }
            $expected = CaseRules::normalize((array) $expected, $ci);
            $map = CaseRules::normalize($map, $ci);
            if (count($expected) !== count($map)) {
                return false;
            }
            if ($ordered && array_keys($expected) !== array_keys($map)) {
                return false;
            }
            foreach ($expected as $key => $value) {
                if (!array_key_exists($key, $map) || !self::equal($value, $map[$key], $ordered, false)) {
                    return false;
                }
            }

            return true;
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
}
