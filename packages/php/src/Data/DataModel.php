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

    /** The kinds of a failure (HY-44.8), the kinds of the template data model. */
    private const FAILURES = [
        'data_number_range',
        'data_number_not_finite',
        'data_invalid_utf8',
        'data_depth',
        'data_unsupported_type',
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
            if (!in_array($error->kind(), self::FAILURES, true)) {
                throw $error;
            }

            return false;
        }
    }

    /**
     * The error of a failure of the data model: of the category type for `data_unsupported_type` and of the category
     * value for every other kind, as the template data model gives them (HY-132.3). Its message is the kind, a colon
     * and the message of the template data model, the text of an error without a template and a position (HY-44.12).
     */
    private static function failure(string $kind, string $message): HyperValueError|HyperTypeError
    {
        $message = "{$kind}: {$message}";

        return $kind === 'data_unsupported_type'
            ? new HyperTypeError($message, $kind)
            : new HyperValueError($message, $kind);
    }

    /**
     * The text of a float outside ±(2^53 − 1) as Rust writes an f64: every such float is an integer, written with all
     * its digits and no exponent.
     */
    private static function floatText(float $value): string
    {
        return sprintf('%.0f', $value);
    }

    /**
     * The cause of a string that is not UTF-8, as Rust writes the error of `String::from_utf8`: the index of the first
     * byte that does not start a valid sequence, and the length of the invalid sequence, or no length when the string
     * ends inside a sequence.
     */
    private static function utf8Cause(string $text): string
    {
        $length = strlen($text);
        $index = 0;
        while ($index < $length) {
            $first = ord($text[$index]);
            if ($first < 0x80) {
                $index++;
                continue;
            }
            [$width, $low, $high] = match (true) {
                $first >= 0xC2 && $first <= 0xDF => [2, 0x80, 0xBF],
                $first === 0xE0 => [3, 0xA0, 0xBF],
                $first === 0xED => [3, 0x80, 0x9F],
                $first >= 0xE1 && $first <= 0xEF => [3, 0x80, 0xBF],
                $first === 0xF0 => [4, 0x90, 0xBF],
                $first === 0xF4 => [4, 0x80, 0x8F],
                $first >= 0xF1 && $first <= 0xF3 => [4, 0x80, 0xBF],
                default => [0, 0, 0],
            };
            if ($width === 0) {
                return "invalid utf-8 sequence of 1 bytes from index {$index}";
            }
            for ($offset = 1; $offset < $width; $offset++) {
                if ($index + $offset >= $length) {
                    return "incomplete utf-8 byte sequence from index {$index}";
                }
                $byte = ord($text[$index + $offset]);
                [$min, $max] = $offset === 1 ? [$low, $high] : [0x80, 0xBF];
                if ($byte < $min || $byte > $max) {
                    return "invalid utf-8 sequence of {$offset} bytes from index {$index}";
                }
            }
            $index += $width;
        }

        return '';
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
                    throw self::failure('data_number_range', "number {$item} is outside the safe range");
                }
                continue;
            }
            if (is_float($item)) {
                if (!is_finite($item)) {
                    throw self::failure('data_number_not_finite', 'number is not finite');
                }
                if (abs($item) > self::MAX_SAFE) {
                    $text = self::floatText($item);
                    throw self::failure('data_number_range', "number {$text} is outside the safe range");
                }
                continue;
            }
            if (is_string($item)) {
                if (preg_match('//u', $item) !== 1) {
                    $cause = self::utf8Cause($item);
                    throw self::failure('data_invalid_utf8', "a string is not valid Unicode text: {$cause}");
                }
                continue;
            }
            // HY-44.6: binding turns a JsonSerializable object into its value.
            if ($item instanceof \JsonSerializable) {
                $stack[] = [$item->jsonSerialize(), $level];
                continue;
            }
            if ($item instanceof \Closure) {
                throw self::failure('data_unsupported_type', 'a function is not a template value');
            }
            if (is_object($item) && !$item instanceof \stdClass) {
                // VAL-19: binding keeps an application object as a native object, which has no JSON form.
                throw self::failure('data_unsupported_type', 'a native object has no JSON form');
            }
            if (!is_array($item) && !$item instanceof \stdClass) {
                $type = get_debug_type($item);
                throw self::failure('data_unsupported_type', "a value of the type {$type} is not a template value");
            }
            if ($level + 1 > self::MAX_DEPTH) {
                throw self::failure('data_depth', 'lists and maps nest deeper than 64 levels');
            }
            foreach (array_reverse(is_array($item) ? $item : get_object_vars($item), true) as $key => $child) {
                $stack[] = [is_int($key) ? null : $key, $level + 1];
                $stack[] = [$child, $level + 1];
            }
        }
    }
}
