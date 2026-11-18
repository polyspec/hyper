<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The values of the template data model that handlers give the server (HY-44). The binding of the core converts a
 * value and fails with the error of the template data model, whose kind and message it gives as they are (HY-44.12);
 * this class holds no rule of the data model. A `JsonSerializable` belongs to the data model when its value does
 * (HY-44.6), so it is replaced by its value, read once, before the binding converts it.
 *
 * @internal
 */
final class DataModel
{
    /** Fails with the error of the binding when a value is not a value of the data model, and returns the value. */
    public static function check(mixed $value): mixed
    {
        CoreRules::shared()->jsonCodecEncode(self::plain($value));

        return $value;
    }

    /**
     * Returns the value with each `JsonSerializable` replaced by its value, read once (HY-44.6); every other value is
     * kept. The extensions of the template and of the core take no `JsonSerializable`.
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
            // HY-44.8: only a failure of the data model, whose kinds start with `data_`, is a value outside it; another
            // failure is not swallowed.
            if (!str_starts_with($error->kind(), 'data_')) {
                throw $error;
            }

            return false;
        }
    }
}
