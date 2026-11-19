<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The Accept field of a request: its ranges, which the core reads (HY-116.17, HY-116.18), and the selection of a media
 * type by the weights of its ranges (HY-116).
 *
 * @internal
 */
final class Accept
{
    /**
     * The kinds of the core for an Accept value that the grammar does not allow or whose weight is not a qvalue; the
     * server answers both with status 400 (HY-116.18).
     */
    private const array INVALID = ['invalid_accept', 'invalid_weight'];

    private function __construct()
    {
    }

    /**
     * Parses an Accept field value into its ranges, in order, with rules.accept_ranges of the core. A null value is a
     * request without Accept, which reads as the range that matches every type (HY-116.17).
     *
     * @return list<MediaRange>
     *
     * @throws HyperValueError of the kind `invalid_accept` or `invalid_weight` when the value does not follow the
     *     grammar, or a weight is not a qvalue (HY-116.18)
     */
    public static function parse(?string $value): array
    {
        $ranges = [];
        foreach (CoreRules::shared()->acceptParse($value) as $range) {
            /** @var string $type */
            $type = $range->type;
            /** @var string $subtype */
            $subtype = $range->subtype;
            /** @var list<array{0: string, 1: string}> $parameters */
            $parameters = $range->parameters;
            /** @var int $weight */
            $weight = $range->weight;
            $ranges[] = new MediaRange($type, $subtype, $parameters, $weight);
        }

        return $ranges;
    }

    /** Whether an error is the failure of an Accept value that `parse` throws (HY-116.18). */
    public static function isInvalid(HyperValueError $error): bool
    {
        return in_array($error->kind(), self::INVALID, true);
    }

    /**
     * Returns the type of the highest weight among the given types with that weight in thousandths, the first on a
     * tie, or null and 0 when no type has a weight above 0 (HY-116).
     *
     * @param list<MediaRange> $ranges
     * @param list<string> $types media types in lower case, in the order of the ties
     * @return array{0: ?string, 1: int}
     */
    public static function best(array $ranges, array $types): array
    {
        $selected = null;
        $best = 0;
        foreach ($types as $type) {
            $weight = self::typeWeight($ranges, $type);
            if ($weight > $best) {
                $selected = $type;
                $best = $weight;
            }
        }

        return [$selected, $best];
    }

    /**
     * Returns the weight in thousandths that the ranges give a type: the weight of the most specific range that
     * matches it, or 0 when no range matches. A range that names the type matches it whatever its parameters (HY-116).
     *
     * @param list<MediaRange> $ranges
     */
    private static function typeWeight(array $ranges, string $type): int
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
}
