<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

/**
 * The form of an identifier that the PHP runtime creates for the PHP server (HY-104.43): `session.sid_length`
 * characters of the alphabet of `session.sid_bits_per_character`, which hyper does not change, within the 22 to 256
 * characters that every server accepts (HY-104.42). The test process runs the PHP of the server, so it reads the same
 * settings.
 */
final class PhpSessionIdentifier
{
    /** The alphabets of PHP for 4, 5 and 6 bits per character (ext/session/session.c, bin_to_readable). */
    private const array ALPHABETS = [4 => '0-9a-f', 5 => '0-9a-v', 6 => '0-9a-zA-Z,-'];

    /** The pattern of an identifier of the settings of this process. */
    public static function pattern(): string
    {
        $length = (int) ini_get('session.sid_length');
        $bits = (int) ini_get('session.sid_bits_per_character');
        if ($length < 22 || $length > 256 || !isset(self::ALPHABETS[$bits])) {
            throw new \UnexpectedValueException(
                "session.sid_length {$length} or session.sid_bits_per_character {$bits} is outside HY-104.42",
            );
        }

        return '[' . self::ALPHABETS[$bits] . ']{' . $length . '}';
    }
}
