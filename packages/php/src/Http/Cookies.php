<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The cookies of a request: one parse of its `Cookie` lines (HY-129), the same in every server, by `parse_cookie` of
 * http-cookie in the core (HY-129.13).
 *
 * @internal
 */
final class Cookies
{
    /**
     * Returns the cookies of the field values of the `Cookie` lines of a request in their order, by name, with
     * `parseCookie` of the core. PHP gives the lines joined as one value, which a host passes as one line
     * (HY-129.15); a request without the field has no line and no cookie.
     *
     * PHP turns a decimal name into an integer key, so the keys are `array-key`; a lookup by the string name finds it.
     *
     * @param list<string> $lines
     *
     * @return array<array-key, string>
     */
    public static function parse(array $lines): array
    {
        $cookies = [];
        foreach (parseCookie($lines) as [$name, $value]) {
            $cookies[$name] = $value;
        }

        return $cookies;
    }
}
