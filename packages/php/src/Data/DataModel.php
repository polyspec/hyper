<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

use Polyspec\Template\Value\Bind;
use Polyspec\Template\Value\BindError;
use Polyspec\Template\Value\MapValue;
use Polyspec\Template\Value\SafeString;

/**
 * The values of the template data model that handlers give the server (HY-44): host binding (VAL-13, VAL-14),
 * then a check that the bound value holds no native object (VAL-19). Binding keeps an application object as it
 * is, and such an object is not a value of the data model.
 *
 * @internal
 */
final class DataModel
{
    /**
     * The kind of each failure of the binding (HY-44.8), the kind of the template data model, and its message; the
     * binding of a value raises no other code.
     */
    private const FAILURES = [
        'E_DATA_NUMBER_RANGE' => [
            'data_number_range',
            'a number outside ±(2^53 − 1) is not a value of the data model (HY-44)',
        ],
        'E_DATA_NUMBER_NOT_FINITE' => [
            'data_number_not_finite',
            'a number that is not finite is not a value of the data model (HY-44)',
        ],
        'E_DATA_INVALID_UTF8' => [
            'data_invalid_utf8',
            'a string that is not UTF-8 text is not a value of the data model (HY-44)',
        ],
        'E_DATA_DEPTH' => [
            'data_depth',
            'lists and maps that nest deeper than 64 levels are not a value of the data model (HY-44)',
        ],
        'E_DATA_UNSUPPORTED_TYPE' => [
            'data_unsupported_type',
            'a value or a map key of another type is not a value of the data model (HY-44)',
        ],
    ];

    /** Binds the value, fails when it is not a value of the data model, and returns the bound value. */
    public static function check(mixed $value): mixed
    {
        $code = null;
        $bound = null;
        try {
            $bound = Bind::value($value);
        } catch (BindError $error) {
            // HY-44.8: a failure of the binding is the error of its kind; another code is no failure of the data model.
            if (!isset(self::FAILURES[$error->errorCode])) {
                throw $error;
            }
            $code = $error->errorCode;
        }
        // The class of the binding takes no previous error, so the error of its kind is raised after the catch.
        if ($code !== null) {
            throw self::failure($code);
        }
        self::walk($bound);

        return $bound;
    }

    /** Returns true for a value of the data model; for example, integers outside ±(2^53 − 1) are not. */
    public static function contains(mixed $value): bool
    {
        try {
            self::check($value);

            return true;
        } catch (HyperValueError | HyperTypeError $error) {
            // HY-44.8: only a kind of the data model is a value outside it; another failure is not swallowed.
            if (!in_array($error->kind(), array_column(self::FAILURES, 0), true)) {
                throw $error;
            }

            return false;
        }
    }

    /**
     * The error of a failure of the data model: of the category type for `data_unsupported_type` and of the category
     * value for every other kind, as the template data model gives them (HY-132.3).
     */
    private static function failure(string $code): HyperValueError|HyperTypeError
    {
        [$kind, $message] = self::FAILURES[$code];

        return $kind === 'data_unsupported_type'
            ? new HyperTypeError($message, $kind)
            : new HyperValueError($message, $kind);
    }

    /** Fails when a bound value holds an application object, which is not a value of the data model. */
    private static function walk(mixed $value): void
    {
        if ($value instanceof MapValue) {
            foreach ($value->values() as $item) {
                self::walk($item);
            }
        } elseif (is_array($value)) {
            foreach ($value as $item) {
                self::walk($item);
            }
        } elseif (is_object($value) && !$value instanceof SafeString) {
            throw self::failure('E_DATA_UNSUPPORTED_TYPE');
        }
    }
}
