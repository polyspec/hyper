<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The cookies of a request: one parse of its `Cookie` header (HY-129), the same in every server.
 *
 * @internal
 */
final class Cookies
{
    /**
     * Returns the cookies of a `Cookie` header, or none for a request without the header. The header splits at each
     * `;`, spaces and tabs at both ends of a pair are removed, and a pair splits at its first `=`. A pair gives no
     * cookie when it has no `=`, an empty name, a name that is not UTF-8 (the name is not decoded), or a value that is
     * not UTF-8 after percent-decoding. Of the pairs that give a cookie, the first of a name counts.
     *
     * PHP turns a decimal name into an integer key, so the keys are `array-key`; a lookup by the string name finds it.
     *
     * @return array<array-key, string>
     */
    public static function parse(?string $header): array
    {
        $cookies = [];
        if ($header === null) {
            return $cookies;
        }
        foreach (explode(';', $header) as $pair) {
            $pair = trim($pair, " \t");
            $equals = strpos($pair, '=');
            if ($equals === false) {
                continue;
            }
            $name = self::utf8(substr($pair, 0, $equals));
            $value = self::utf8(self::percentDecode(substr($pair, $equals + 1)));
            if ($name !== null && $name !== '' && $value !== null && !array_key_exists($name, $cookies)) {
                $cookies[$name] = $value;
            }
        }

        return $cookies;
    }

    /** Replaces each `%` with two hexadecimal digits by its byte; every other byte, `+` included, is kept. */
    private static function percentDecode(string $bytes): string
    {
        return rawurldecode($bytes);
    }

    /** Returns the bytes as UTF-8 text, or null when they are not UTF-8. */
    private static function utf8(string $bytes): ?string
    {
        return preg_match('//u', $bytes) === 1 ? $bytes : null;
    }
}
