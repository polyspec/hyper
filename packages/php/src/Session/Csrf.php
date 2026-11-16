<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * Masks the session token for a response and verifies a masked form value (HY-24). A masked value is 32 mask bytes
 * followed by the mask XOR the token, as 128 lowercase hexadecimal digits, so no response contains the token. The rules
 * are those of the core (HY-132.2).
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
        return CoreRules::shared()->csrfMask($token, $mask);
    }

    /** Returns true when a form value is a masked value of the token, compared in constant time. */
    public static function verify(string $token, string $value): bool
    {
        return CoreRules::shared()->csrfVerify($token, $value);
    }

    /**
     * Returns the SHA-256 digest, as 64 lowercase hexadecimal digits, of the token that a masked value holds, or null
     * for the empty text, which a request without a session holds (HY-24.10, HY-24.12).
     */
    public static function browserOf(string $masked): ?string
    {
        return CoreRules::shared()->csrfBrowserOf($masked);
    }
}
