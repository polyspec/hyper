<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

use Polyspec\Template\Value\Bind;
use Polyspec\Template\Value\MapValue;
use Polyspec\Template\Value\SafeString;

/**
 * The values of the template data model that handlers give the server (HY-44): host binding (VAL-13, VAL-14),
 * then a check that the bound value holds no native object (VAL-19). Binding keeps an application object as it
 * is, and such an object is not a value of the data model.
 */
final class DataModel
{
    /** Binds the value and fails when it is not a value of the data model. */
    public static function check(mixed $value): void
    {
        self::noNativeObject(Bind::value($value));
    }

    /** Returns true for a value of the data model; for example, integers outside ±(2^53 − 1) are not. */
    public static function contains(mixed $value): bool
    {
        try {
            self::check($value);

            return true;
        } catch (\Throwable) {
            return false;
        }
    }

    private static function noNativeObject(mixed $value): void
    {
        if ($value instanceof MapValue) {
            foreach ($value->values() as $item) {
                self::noNativeObject($item);
            }
        } elseif (is_array($value)) {
            foreach ($value as $item) {
                self::noNativeObject($item);
            }
        } elseif (is_object($value) && !$value instanceof SafeString) {
            throw new \UnexpectedValueException('an application object of class ' . $value::class . ' is not a value of the data model');
        }
    }
}
