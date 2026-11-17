<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

/**
 * The selection of cases of the case runner (H35.9-11): the names of RECIPE_CASES, which white space separates. A
 * name `<file>#<section>` names the cases of a section, a name that ends with `.json` the cases of a file, and any
 * other name the cases of that id in every file.
 */
final class CaseSelection
{
    /** @return list<string> the names of a selection */
    public static function names(string $selection): array
    {
        $names = preg_split('/\s+/', $selection, -1, PREG_SPLIT_NO_EMPTY);

        return $names === false ? [] : $names;
    }

    /**
     * The cases that a selection names, in the order of the runner. A selection without a name and a name that names
     * no case of the runner fail, with the selection and each such name (HR-84).
     *
     * @template T
     *
     * @param list<T> $cases
     * @param callable(T): array{0: string, 1: string, 2: string} $nameOf the file, the section and the id of a case
     *
     * @return list<T>
     */
    public static function select(string $selection, array $cases, callable $nameOf): array
    {
        $runner = CaseRules::LANGUAGE;
        $names = self::names($selection);
        if ($names === []) {
            throw new \UnexpectedValueException("the selection \"$selection\" of the $runner runner names no case");
        }

        $selected = [];
        $matched = [];
        foreach ($cases as $case) {
            $named = array_filter($names, static fn (string $name): bool => self::isNamed($name, $nameOf($case)));
            if ($named !== []) {
                $selected[] = $case;
                $matched += array_fill_keys($named, true);
            }
        }

        $unmatched = array_filter($names, static fn (string $name): bool => !array_key_exists($name, $matched));
        if ($unmatched !== []) {
            throw new \UnexpectedValueException(
                "the selection \"$selection\" of the $runner runner selects no case for " . implode(', ', $unmatched),
            );
        }

        return $selected;
    }

    /** @param array{0: string, 1: string, 2: string} $case the file, the section and the id of a case */
    private static function isNamed(string $name, array $case): bool
    {
        [$file, $section, $id] = $case;
        if (str_contains($name, '#')) {
            return $name === "$file#$section";
        }

        return str_ends_with($name, '.json') ? $name === $file : $name === $id;
    }
}
