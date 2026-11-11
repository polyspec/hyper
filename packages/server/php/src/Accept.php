<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The Accept field of a request: its parser (RFC 9110, section 12.5.1) and the selection of a media type by the
 * weights of its ranges (HY-116). An instance reads one value from its start to its end.
 *
 * @internal
 */
final class Accept
{
    /** The weight of a range without q, and of q=1, in thousandths (RFC 9110, section 12.4.2). */
    private const ANY = 1000;

    /** The characters of a token (RFC 9110, section 5.6.2). */
    private const TCHAR = "!#$%&'*+-.^_`|~0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

    /** The position of the next character to read. */
    private int $pos = 0;

    private function __construct(private readonly string $text)
    {
    }

    /**
     * Parses an Accept field value into its ranges, in order. A null value is a request without Accept, which reads
     * as the range that matches every type (RFC 9110, section 12.5.1; HY-116). An empty value is an empty list, and an
     * empty list element is ignored (RFC 9110, section 5.6.1). The names of the types, subtypes and parameters are in
     * lower case. The parameters are those before `q`, and the weight is the qvalue in thousandths (RFC 9110, section
     * 12.4.2). What follows `q` is an accept extension, which is checked and not read (RFC 9110, section 12.4.2).
     *
     * @return list<MediaRange>
     *
     * @throws InvalidAccept when the value does not follow the grammar, or a weight is not a qvalue
     */
    public static function parse(?string $value): array
    {
        if ($value === null) {
            return [new MediaRange('*', '*', [], self::ANY)];
        }
        $reader = new self($value);
        $ranges = [];
        $reader->skipOws();
        while (!$reader->end()) {
            if ($reader->at(',')) {
                $reader->pos++;
                $reader->skipOws();

                continue;
            }
            $ranges[] = $reader->range();
            $reader->skipOws();
            if (!$reader->end()) {
                $reader->expect(',');
                $reader->skipOws();
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
     * @throws InvalidAccept when the value does not follow the grammar, or a weight is not a qvalue
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
     * @param list<MediaRange> $ranges
     */
    private static function weight(array $ranges, string $type): int
    {
        [$name, $subtype] = explode('/', $type, 2);
        $specificity = 0;
        $weight = 0;
        foreach ($ranges as $range) {
            $match = match (true) {
                $range->type === '*' => 1,
                $range->type === $name && $range->subtype === '*' => 2,
                $range->type === $name && $range->subtype === $subtype => 3,
                default => 0,
            };
            if ($match === 0) {
                continue;
            }
            if ($match > $specificity || ($match === $specificity && $range->weight > $weight)) {
                $specificity = $match;
                $weight = $range->weight;
            }
        }

        return $weight;
    }

    /** Reads one media range: `type "/" subtype`, then its parameters and its weight (RFC 9110, section 12.5.1). */
    private function range(): MediaRange
    {
        $type = strtolower($this->token());
        $this->expect('/');
        $subtype = strtolower($this->token());
        if ($type === '*' && $subtype !== '*') {
            throw $this->invalid('a wildcard type has a subtype');
        }
        $parameters = [];
        $weight = self::ANY;
        $weighted = false;
        while (true) {
            $this->skipOws();
            if (!$this->at(';')) {
                break;
            }
            $this->pos++;
            $this->skipOws();
            $name = strtolower($this->token());
            if ($weighted) {
                // An accept extension after the weight: `token [ "=" ( token / quoted-string ) ]`, read and not kept.
                if ($this->at('=')) {
                    $this->pos++;
                    $this->parameterValue();
                }

                continue;
            }
            $this->expect('=');
            if ($name === 'q') {
                $weight = $this->qvalue();
                $weighted = true;

                continue;
            }
            $parameters[] = [$name, $this->parameterValue()];
        }

        return new MediaRange($type, $subtype, $parameters, $weight);
    }

    /** Reads a qvalue and returns it in thousandths: `0[.000-999]` or `1[.000]` (RFC 9110, section 12.4.2). */
    private function qvalue(): int
    {
        $text = $this->token();
        if (preg_match('/^(0(\.[0-9]{0,3})?|1(\.0{0,3})?)$/', $text) !== 1) {
            throw $this->invalid("the weight $text is not a qvalue");
        }
        [$whole, $fraction] = array_pad(explode('.', $text, 2), 2, '');

        return (int) $whole * self::ANY + (int) str_pad($fraction, 3, '0');
    }

    /** Reads a parameter value, a token or a quoted string, and returns it unquoted (RFC 9110, section 5.6.6). */
    private function parameterValue(): string
    {
        return $this->at('"') ? $this->quoted() : $this->token();
    }

    /** Reads a quoted string and returns its text without the quotes and the quoted pairs (RFC 9110, section 5.6.4). */
    private function quoted(): string
    {
        $this->expect('"');
        $text = '';
        while (true) {
            if ($this->end()) {
                throw $this->invalid('an unterminated quoted string');
            }
            $char = $this->text[$this->pos];
            $this->pos++;
            if ($char === '"') {
                return $text;
            }
            if ($char === '\\') {
                if ($this->end() || !self::quotedPairCharacter(ord($this->text[$this->pos]))) {
                    throw $this->invalid('an invalid quoted pair');
                }
                $text .= $this->text[$this->pos];
                $this->pos++;

                continue;
            }
            if (!self::qdtextCharacter(ord($char))) {
                throw $this->invalid('an invalid character in a quoted string');
            }
            $text .= $char;
        }
    }

    /** Whether a byte is a qdtext: HTAB, SP, %x21, %x23-5B, %x5D-7E or obs-text (RFC 9110, section 5.6.4). */
    private static function qdtextCharacter(int $code): bool
    {
        return $code === 0x09 || $code === 0x20 || $code === 0x21 || ($code >= 0x23 && $code <= 0x5B)
            || ($code >= 0x5D && $code <= 0x7E) || ($code >= 0x80 && $code <= 0xFF);
    }

    /** Whether a byte may follow the backslash of a quoted pair: HTAB, SP, VCHAR or obs-text (RFC 9110, 5.6.4). */
    private static function quotedPairCharacter(int $code): bool
    {
        return $code === 0x09 || $code === 0x20 || ($code >= 0x21 && $code <= 0x7E) || ($code >= 0x80 && $code <= 0xFF);
    }

    /** Reads a token (RFC 9110, section 5.6.2). */
    private function token(): string
    {
        $length = strspn($this->text, self::TCHAR, $this->pos);
        if ($length === 0) {
            throw $this->invalid('expected a token');
        }
        $token = substr($this->text, $this->pos, $length);
        $this->pos += $length;

        return $token;
    }

    /** Skips the optional white space (RFC 9110, section 5.6.3). */
    private function skipOws(): void
    {
        $this->pos += strspn($this->text, " \t", $this->pos);
    }

    /** Reads the character `$char`, which must come next. */
    private function expect(string $char): void
    {
        if (!$this->at($char)) {
            throw $this->invalid("expected $char");
        }
        $this->pos++;
    }

    /** Whether the next character is `$char`. */
    private function at(string $char): bool
    {
        return $this->pos < strlen($this->text) && $this->text[$this->pos] === $char;
    }

    /** Whether the whole value has been read. */
    private function end(): bool
    {
        return $this->pos >= strlen($this->text);
    }

    /** The error of a value that the grammar does not allow, at the current position. */
    private function invalid(string $reason): InvalidAccept
    {
        return new InvalidAccept(sprintf(
            'hyper: the Accept value %s is invalid at %d: %s (HY-116)',
            json_encode($this->text, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE),
            $this->pos,
            $reason,
        ));
    }
}
