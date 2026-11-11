<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * Masks the session token for a response and verifies a masked form value (HY-24). A masked value is 32 mask bytes
 * followed by the mask XOR the token, as 128 lowercase hexadecimal digits, so no response contains the token.
 *
 * @internal
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
        self::requireToken($token);
        self::requireToken($mask);

        return $mask . bin2hex(self::xor(self::bytes($mask), self::bytes($token)));
    }

    /** Returns true when a form value is a masked value of the token, compared in constant time. */
    public static function verify(string $token, string $value): bool
    {
        self::requireToken($token);
        if (preg_match('/^[0-9a-f]{128}$/D', $value) !== 1) {
            return false;
        }

        return hash_equals(self::bytes($token), self::xor(self::bytes(substr($value, 64)), self::bytes(substr($value, 0, 64))));
    }

    /** Fails for a token or a mask that is not 64 lowercase hexadecimal digits (HY-24.9). */
    private static function requireToken(string $text): void
    {
        if (preg_match('/^[0-9a-f]{64}$/D', $text) !== 1) {
            throw new \InvalidArgumentException('a CSRF token or mask is not 64 lowercase hexadecimal digits (HY-24)');
        }
    }

    /** Returns the bytes of an even number of lowercase hexadecimal digits; other text fails. */
    private static function bytes(string $hex): string
    {
        // hex2bin accepts upper case digits and warns for other text, so the digits are checked first.
        $bytes = preg_match('/^(?:[0-9a-f]{2})*$/D', $hex) === 1 ? hex2bin($hex) : false;
        if ($bytes === false) {
            throw new \InvalidArgumentException('a CSRF token or mask is not lowercase hexadecimal digits (HY-24)');
        }

        return $bytes;
    }

    /** Returns the bytes of the first XOR the bytes of the second, which have one length; other bytes fail. */
    private static function xor(string $first, string $second): string
    {
        if (strlen($first) !== strlen($second)) {
            throw new \InvalidArgumentException('the bytes of a CSRF token and its mask differ in length (HY-24)');
        }

        return $first ^ $second;
    }
}
