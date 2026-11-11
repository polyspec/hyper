<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\Csrf;
use Polyspec\Hyper\Tests\CaseReader;

/** HY-24: the cases of contracts/csrf.json, the masked values of a token and their verification. */
final class CsrfSteps
{
    public static function mask(CaseReader $case): void
    {
        $case->compare('value', Csrf::mask(self::text($case, 'token'), self::text($case, 'mask')));
    }

    public static function verify(CaseReader $case): void
    {
        $case->compare('valid', Csrf::verify(self::text($case, 'token'), self::text($case, 'value')));
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

    private static function text(CaseReader $case, string $name): string
    {
        $value = $case->input($name);
        if (!is_string($value)) {
            throw new \UnexpectedValueException("the case field {$name} is not a string");
        }

        return $value;
    }
}
