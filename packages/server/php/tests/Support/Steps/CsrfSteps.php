<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\Csrf;
use Polyspec\Hyper\Tests\CaseReader;

/** HY-24: the cases of contracts/csrf.json, the masked values of a token and their verification. */
final class CsrfSteps
{
    /** Masks the token with the mask, or records the message of the error with which it fails (HY-24.9). */
    public static function mask(CaseReader $case): void
    {
        $value = null;
        $error = null;
        try {
            $value = Csrf::mask(self::text($case, 'token'), self::text($case, 'mask'));
        } catch (\InvalidArgumentException $failure) {
            $error = $failure->getMessage();
        }
        $case->compare('value', $value);
        $case->compare('error', $error);
    }

    /** Verifies the value against the token, or records the message of the error with which it fails (HY-24.9). */
    public static function verify(CaseReader $case): void
    {
        $valid = null;
        $error = null;
        try {
            $valid = Csrf::verify(self::text($case, 'token'), self::text($case, 'value'));
        } catch (\InvalidArgumentException $failure) {
            $error = $failure->getMessage();
        }
        $case->compare('valid', $valid);
        $case->compare('error', $error);
    }

    public static function masked(CaseReader $case): void
    {
        $token = self::text($case, 'token');
        $first = Csrf::masked($token);
        $second = Csrf::masked($token);
        $case->compare('hexadecimal', preg_match('/^[0-9a-f]{128}$/D', $first) === 1);
        $case->compare('distinct', $first !== $second);
        $case->compare('valid', Csrf::verify($token, $first) && Csrf::verify($token, $second));
    }

    /** Gives the digest of the masked value, or records the message of the error with which it fails (HY-24.13). */
    public static function browser(CaseReader $case): void
    {
        $browser = null;
        $error = null;
        try {
            $browser = Csrf::browserOf(self::text($case, 'value'));
        } catch (\InvalidArgumentException $failure) {
            $error = $failure->getMessage();
        }
        $case->compare('browser', $browser);
        $case->compare('error', $error);
    }

    private static function text(CaseReader $case, string $name): string
    {
        $value = $case->input($name);
        if (!is_string($value)) {
            throw new \UnexpectedValueException("the case field {$name} is not a string");
        }

        return $value;
    }
}
