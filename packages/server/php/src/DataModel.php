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
    /** The message of each kind of failure of the binding (HY-44.8); the binding of a value raises no other code. */
    private const MESSAGES = [
        'E_DATA_NUMBER_RANGE' => 'a number outside ±(2^53 − 1) is not a value of the data model (HY-44)',
        'E_DATA_NUMBER_NOT_FINITE' => 'a number that is not finite is not a value of the data model (HY-44)',
        'E_DATA_INVALID_UTF8' => 'a string that is not UTF-8 text is not a value of the data model (HY-44)',
        'E_DATA_DEPTH' => 'lists and maps that nest deeper than 64 levels are not a value of the data model (HY-44)',
        'E_DATA_UNSUPPORTED_TYPE' => 'a value or a map key of another type is not a value of the data model (HY-44)',
    ];

    /** Binds the value, fails when it is not a value of the data model, and returns the bound value. */
    public static function check(mixed $value): mixed
    {
        try {
            $bound = Bind::value($value);
        } catch (BindError $error) {
            // HY-44.8: a failure of the binding is the error of its kind, with the error of the binding as previous.
            $message = self::MESSAGES[$error->errorCode] ?? throw $error;
            throw new \InvalidArgumentException($message, 0, $error);
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
        } catch (\InvalidArgumentException) {
            return false;
        }
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
            throw new \InvalidArgumentException(self::MESSAGES['E_DATA_UNSUPPORTED_TYPE']);
        }
    }
}
