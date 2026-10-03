<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * Masks the session token for a response and verifies a masked form value (HY-24). A masked value is 32 mask bytes
 * followed by the mask XOR the token, as 128 lowercase hexadecimal digits, so no response contains the token.
 */
final class Csrf
{
    /** Returns the token masked with a new random mask. */
    public static function masked(string $token): string
    {
        return self::mask($token, bin2hex(random_bytes(32)));
    }

    /** Returns the token masked with a mask; both are 64 lowercase hexadecimal digits. */
    public static function mask(string $token, string $mask): string
    {
        return $mask . bin2hex(self::bytes($mask) ^ self::bytes($token));
    }

    /** Returns true when a form value is a masked value of the token, compared in constant time. */
    public static function verify(string $token, string $value): bool
    {
        if (preg_match('/^[0-9a-f]{128}$/D', $value) !== 1) {
            return false;
        }

        return hash_equals(self::bytes($token), self::bytes(substr($value, 0, 64)) ^ self::bytes(substr($value, 64)));
    }

    /** Returns the bytes of an even number of hexadecimal digits; other text fails. */
    private static function bytes(string $hex): string
    {
        $bytes = hex2bin($hex);
        if ($bytes === false) {
            throw new \InvalidArgumentException('a CSRF token or mask is not hexadecimal digits');
        }

        return $bytes;
    }
}
