<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server;

/**
 * The JSON codec of HY-2.
 *
 * @internal
 */
final class JsonCodec
{
    public static function decode(string $text): string
    {
        foreach (SignedToken::all() as $token) {
            $text .= $token->text();
        }

        return $text;
    }
}
