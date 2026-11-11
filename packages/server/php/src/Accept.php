<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The Accept field of a request: its parser (RFC 9110, section 12.5.1) and the selection of a media type by the
 * weights of its ranges (HY-116).
 *
 * @internal
 */
final class Accept
{
    /** The weight of a range without q, and of q=1, in thousandths (RFC 9110, section 12.4.2). */
    private const ANY = 1000;

    /** The characters of a token (RFC 9110, section 5.6.2). */
    private const TCHAR = "!#$%&'*+-.^_`|~0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

    /**
     * Parses an Accept field value into its ranges, in order. A null value is a request without Accept, which reads
     * as the range that matches every type (RFC 9110, section 12.5.1; HY-116). An empty value is an empty list, and an
     * empty list element is ignored (RFC 9110, section 5.6.1). The names of the types, subtypes and parameters are in
     * lower case. The parameters are those before `q`, and the weight is the qvalue in thousandths (RFC 9110, section
     * 12.4.2). What follows `q` is an accept extension, which is checked and not read (RFC 9110, section 12.4.2).
     *
     * @return list<array{type: string, subtype: string, parameters: list<array{name: string, value: string}>,
     *     weight: int}>
     *
     * @throws \InvalidArgumentException when the value does not follow the grammar, or a weight is not a qvalue
     */
    public static function parse(?string $value): array
    {
        if ($value === null) {
            return [['type' => '*', 'subtype' => '*', 'parameters' => [], 'weight' => self::ANY]];
        }
        $pos = 0;
        $ranges = [];
        self::skipOws($value, $pos);
        while ($pos < strlen($value)) {
            if ($value[$pos] === ',') {
                $pos++;
                self::skipOws($value, $pos);

                continue;
            }
            $ranges[] = self::range($value, $pos);
            self::skipOws($value, $pos);
            if ($pos < strlen($value)) {
                self::expect($value, $pos, ',');
                self::skipOws($value, $pos);
            }
        }

        return $ranges;
    }

    /**
     * Returns the media type of the request among the given types, or null when no type has a weight above 0
     * (HY-116). A type takes the weight of its most specific matching range, and among the ranges of that
     * specificity the one of the highest weight. The first type of the list wins a tie.
     *
     * @param list<string> $types media types in lower case, in the order of the ties
     *
     * @throws \InvalidArgumentException when the value does not follow the grammar, or a weight is not a qvalue
     */
    public static function select(?string $value, array $types): ?string
    {
        $ranges = self::parse($value);
        $selected = null;
        $best = 0;
        foreach ($types as $type) {
            $weight = self::weight($ranges, $type);
            if ($weight > $best) {
                $selected = $type;
                $best = $weight;
            }
        }

        return $selected;
    }

    /**
     * Returns the weight in thousandths that the ranges give a type: the weight of the most specific range that
     * matches it, or 0 when no range matches. A range that names the type matches it whatever its parameters (HY-116).
     *
     * @param list<array{type: string, subtype: string, parameters: list<array{name: string, value: string}>,
     *     weight: int}> $ranges
     */
    private static function weight(array $ranges, string $type): int
    {
        [$name, $subtype] = explode('/', $type, 2);
        $specificity = 0;
        $weight = 0;
        foreach ($ranges as $range) {
            $match = match (true) {
                $range['type'] === '*' => 1,
                $range['type'] === $name && $range['subtype'] === '*' => 2,
                $range['type'] === $name && $range['subtype'] === $subtype => 3,
                default => 0,
            };
            if ($match === 0) {
                continue;
            }
            if ($match > $specificity || ($match === $specificity && $range['weight'] > $weight)) {
                $specificity = $match;
                $weight = $range['weight'];
            }
        }

        return $weight;
    }

    /**
     * Reads one media range at `$pos`: `type "/" subtype`, then its parameters and its weight (RFC 9110, section
     * 12.5.1).
     *
     * @return array{type: string, subtype: string, parameters: list<array{name: string, value: string}>, weight: int}
     */
    private static function range(string $value, int &$pos): array
    {
        $type = strtolower(self::token($value, $pos));
        self::expect($value, $pos, '/');
        $subtype = strtolower(self::token($value, $pos));
        if ($type === '*' && $subtype !== '*') {
            throw self::invalid();
        }
        $parameters = [];
        $weight = self::ANY;
        $weighted = false;
        while (true) {
            self::skipOws($value, $pos);
            if ($pos >= strlen($value) || $value[$pos] !== ';') {
                break;
            }
            $pos++;
            self::skipOws($value, $pos);
            $name = strtolower(self::token($value, $pos));
            if (!$weighted && $name === 'q') {
                self::expect($value, $pos, '=');
                $weight = self::qvalue($value, $pos);
                $weighted = true;

                continue;
            }
            if (!$weighted) {
                self::expect($value, $pos, '=');
                $parameters[] = ['name' => $name, 'value' => self::value($value, $pos)];

                continue;
            }
            // An accept extension after the weight: `token [ "=" ( token / quoted-string ) ]`, read and not kept.
            if ($pos < strlen($value) && $value[$pos] === '=') {
                $pos++;
                self::value($value, $pos);
            }
        }

        return ['type' => $type, 'subtype' => $subtype, 'parameters' => $parameters, 'weight' => $weight];
    }

    /**
     * Reads a qvalue at `$pos` and returns it in thousandths: `0[.000-999]` or `1[.000]` (RFC 9110, section 12.4.2).
     */
    private static function qvalue(string $value, int &$pos): int
    {
        if (preg_match('/\G(0(?:\.[0-9]{0,3})?|1(?:\.0{0,3})?)/', $value, $found, 0, $pos) !== 1) {
            throw self::invalid();
        }
        $pos += strlen($found[1]);
        [$whole, $fraction] = array_pad(explode('.', $found[1], 2), 2, '');

        return (int) $whole * self::ANY + (int) str_pad($fraction, 3, '0');
    }

    /**
     * Reads a parameter value at `$pos`, a token or a quoted string, and returns it unquoted (RFC 9110, section
     * 5.6.4).
     */
    private static function value(string $value, int &$pos): string
    {
        if ($pos < strlen($value) && $value[$pos] === '"') {
            return self::quoted($value, $pos);
        }

        return self::token($value, $pos);
    }

    /** Reads a quoted string at `$pos` and returns its unquoted text (RFC 9110, section 5.6.4). */
    private static function quoted(string $value, int &$pos): string
    {
        $length = strlen($value);
        $text = '';
        $pos++;
        while ($pos < $length) {
            $char = $value[$pos];
            if ($char === '"') {
                $pos++;

                return $text;
            }
            if ($char === '\\') {
                $pos++;
                if ($pos >= $length || !self::quotedPairCharacter(ord($value[$pos]))) {
                    throw self::invalid();
                }
                $text .= $value[$pos];
                $pos++;

                continue;
            }
            if (!self::qdtextCharacter(ord($char))) {
                throw self::invalid();
            }
            $text .= $char;
            $pos++;
        }

        throw self::invalid();
    }

    /**
     * Returns true for a character of a qdtext: HTAB, SP, %x21, %x23-5B, %x5D-7E or obs-text (RFC 9110, section
     * 5.6.4).
     */
    private static function qdtextCharacter(int $code): bool
    {
        return $code === 9 || $code === 32 || $code === 0x21 || ($code >= 0x23 && $code <= 0x7E && $code !== 0x5C)
            || $code >= 0x80;
    }

    /** Returns true for a character of a quoted pair: HTAB, SP, VCHAR or obs-text (RFC 9110, section 5.6.4). */
    private static function quotedPairCharacter(int $code): bool
    {
        return $code === 9 || $code === 32 || ($code >= 0x21 && $code <= 0x7E) || $code >= 0x80;
    }

    /** Reads a token at `$pos` (RFC 9110, section 5.6.2). */
    private static function token(string $value, int &$pos): string
    {
        $length = strspn($value, self::TCHAR, $pos);
        if ($length === 0) {
            throw self::invalid();
        }
        $token = substr($value, $pos, $length);
        $pos += $length;

        return $token;
    }

    /** Skips the optional whitespace at `$pos` (RFC 9110, section 5.6.3). */
    private static function skipOws(string $value, int &$pos): void
    {
        $pos += strspn($value, " \t", $pos);
    }

    /** Consumes the character at `$pos`, which must be `$char`. */
    private static function expect(string $value, int &$pos, string $char): void
    {
        if ($pos >= strlen($value) || $value[$pos] !== $char) {
            throw self::invalid();
        }
        $pos++;
    }

    private static function invalid(): \InvalidArgumentException
    {
        return new \InvalidArgumentException('the Accept value does not follow RFC 9110, section 12.5.1');
    }
}
