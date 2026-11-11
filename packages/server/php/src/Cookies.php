<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * Parses the `Cookie` header of a request (HY-129), the same parse in every server.
 *
 * @internal
 */
final class Cookies
{
    /**
     * Returns the cookies of a `Cookie` header, or none for a request without the header. The header splits at each `;`,
     * and spaces and tabs at both ends of a pair are removed. A pair gives no cookie when it has no `=`, when its name is
     * empty or not UTF-8, or when its value is not UTF-8 after percent-decoding; the name is not decoded. Of the pairs
     * that give a cookie, the first of a name counts.
     *
     * PHP turns a decimal name into an integer key, so the keys are `array-key`; a lookup by the string name finds it.
     *
     * @return array<array-key, string>
     */
    public static function parse(?string $header): array
    {
        $cookies = [];
        foreach (explode(';', $header ?? '') as $pair) {
            $pair = trim($pair, " \t");
            $equals = strpos($pair, '=');
            if ($equals === false) {
                continue;
            }
            $name = substr($pair, 0, $equals);
            $value = rawurldecode(substr($pair, $equals + 1));
            if ($name === '' || preg_match('//u', $name) !== 1 || preg_match('//u', $value) !== 1) {
                continue;
            }
            if (!array_key_exists($name, $cookies)) {
                $cookies[$name] = $value;
            }
        }

        return $cookies;
    }
}
