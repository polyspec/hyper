<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The values of the template data model that handlers give the server (HY-44), checked as the Python server checks
 * them: a value belongs to the data model when it is null, a boolean, an integer or a float within ±(2^53 − 1), a
 * UTF-8 string, an array or a `stdClass` whose keys are UTF-8 strings or integers, or a `JsonSerializable` whose value
 * is one of these, and arrays and objects nest no deeper than 64 levels (VAL-20). Any other object is not a value of
 * the data model.
 *
 * @internal
 */
final class DataModel
{
    private const MAX_SAFE = 9007199254740991;
    private const MAX_DEPTH = 64;

    /** The kind of each failure (HY-44.8), the kind of the template data model, and its message. */
    private const FAILURES = [
        'data_number_range' => 'a number outside ±(2^53 − 1) is not a value of the data model (HY-44)',
        'data_number_not_finite' => 'a number that is not finite is not a value of the data model (HY-44)',
        'data_invalid_utf8' => 'a string that is not UTF-8 text is not a value of the data model (HY-44)',
        'data_depth' => 'lists and maps that nest deeper than 64 levels are not a value of the data model (HY-44)',
        'data_unsupported_type' => 'a value or a map key of another type is not a value of the data model (HY-44)',
    ];

    /** Fails with the error of its kind when a value is not a value of the data model, and returns the value. */
    public static function check(mixed $value): mixed
    {
        self::walk($value);

        return $value;
    }

    /**
     * Returns the value with each `JsonSerializable` replaced by its value, read once (HY-44.6); every other value is
     * kept. The extensions of the template and of the core take no `JsonSerializable`, so the renderer and the JSON
     * text give them this value.
     */
    public static function plain(mixed $value): mixed
    {
        if ($value instanceof \JsonSerializable) {
            return self::plain($value->jsonSerialize());
        }
        if (is_array($value)) {
            return array_map(self::plain(...), $value);
        }
        if ($value instanceof \stdClass) {
            return (object) array_map(self::plain(...), get_object_vars($value));
        }

        return $value;
    }

    /** Returns true for a value of the data model; for example, integers outside ±(2^53 − 1) are not. */
    public static function contains(mixed $value): bool
    {
        try {
            self::check($value);

            return true;
        } catch (HyperValueError | HyperTypeError $error) {
            // HY-44.8: only a kind of the data model is a value outside it; another failure is not swallowed.
            if (!array_key_exists($error->kind(), self::FAILURES)) {
                throw $error;
            }

            return false;
        }
    }

    /**
     * The error of a failure of the data model: of the category type for `data_unsupported_type` and of the category
     * value for every other kind, as the template data model gives them (HY-132.3).
     */
    private static function failure(string $kind): HyperValueError|HyperTypeError
    {
        $message = self::FAILURES[$kind];

        return $kind === 'data_unsupported_type'
            ? new HyperTypeError($message, $kind)
            : new HyperValueError($message, $kind);
    }

    /**
     * Fails with the error of its kind at the first item that is not a value of the data model; the items are kept on
     * a stack with their nesting level, so a deep value fails by its level and not by the recursion of PHP.
     */
    private static function walk(mixed $value): void
    {
        /** @var list<array{mixed, int}> $stack */
        $stack = [[$value, 0]];
        while ($stack !== []) {
            [$item, $level] = array_pop($stack);
            if ($item === null || is_bool($item)) {
                continue;
            }
            if (is_int($item)) {
                if ($item > self::MAX_SAFE || $item < -self::MAX_SAFE) {
                    throw self::failure('data_number_range');
                }
                continue;
            }
            if (is_float($item)) {
                if (!is_finite($item)) {
                    throw self::failure('data_number_not_finite');
                }
                if (abs($item) > self::MAX_SAFE) {
                    throw self::failure('data_number_range');
                }
                continue;
            }
            if (is_string($item)) {
                if (preg_match('//u', $item) !== 1) {
                    throw self::failure('data_invalid_utf8');
                }
                continue;
            }
            // HY-44.6: binding turns a JsonSerializable object into its value.
            if ($item instanceof \JsonSerializable) {
                $stack[] = [$item->jsonSerialize(), $level];
                continue;
            }
            if (!is_array($item) && !$item instanceof \stdClass) {
                throw self::failure('data_unsupported_type');
            }
            if ($level + 1 > self::MAX_DEPTH) {
                throw self::failure('data_depth');
            }
            foreach (array_reverse(is_array($item) ? $item : get_object_vars($item), true) as $key => $child) {
                $stack[] = [is_int($key) ? null : $key, $level + 1];
                $stack[] = [$child, $level + 1];
            }
        }
    }
}
