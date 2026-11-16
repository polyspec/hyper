<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\Csrf;
use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\CaseRules;

/** HY-24: the cases of contracts/csrf.json, the masked values of a token and their verification. */
final class CsrfSteps
{
    /** Masks the token with the mask, or records the failure with which it fails (HY-24.9). */
    public static function mask(CaseReader $case): void
    {
        $token = self::text($case, 'token');
        $mask = self::text($case, 'mask');
        $outcome = CaseRules::failureOf(static fn (): string => Csrf::mask($token, $mask));
        $case->compare('value', $outcome['result']);
        $case->compare('raises', $outcome['raises']);
    }

    /** Verifies the value against the token, or records the failure with which it fails (HY-24.9). */
    public static function verify(CaseReader $case): void
    {
        $token = self::text($case, 'token');
        $value = self::text($case, 'value');
        $outcome = CaseRules::failureOf(static fn (): bool => Csrf::verify($token, $value));
        $case->compare('valid', $outcome['result']);
        $case->compare('raises', $outcome['raises']);
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

    /** Gives the digest of the masked value, or records the failure with which it fails (HY-24.13). */
    public static function browser(CaseReader $case): void
    {
        $value = self::text($case, 'value');
        $outcome = CaseRules::failureOf(static fn (): ?string => Csrf::browserOf($value));
        $case->compare('browser', $outcome['result']);
        $case->compare('raises', $outcome['raises']);
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
