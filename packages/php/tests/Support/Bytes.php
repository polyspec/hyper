<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

/** The bytes of the text of a case, whose characters U+0000 to U+00FF are bytes. */
final class Bytes
{
    /**
     * Returns the bytes of a text, and fails for a character above U+00FF, which a conversion to ISO-8859-1 replaces
     * with `?`.
     */
    public static function of(string $text): string
    {
        if (preg_match('/[^\x{00}-\x{FF}]/u', $text) !== 0) {
            throw new \InvalidArgumentException('the text of the case holds a character above U+00FF or is not UTF-8');
        }

        return (string) mb_convert_encoding($text, 'ISO-8859-1', 'UTF-8');
    }
}
