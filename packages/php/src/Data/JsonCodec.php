<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The JSON text of the servers (HY-17, HY-54): the JSON response value, its text with rules.json_write of the core, and
 * the reading of a JSON text with rules.json_read of the core.
 *
 * @internal
 */
final class JsonCodec
{
    /**
     * Returns the response value; empty maps are `stdClass` so that JSON encoding and template binding both see maps.
     *
     * @param array<string, string> $params
     * @param string $build the build id of the application, which follows `params` (HY-128)
     * @param ?array<string, mixed> $context the member `context` of HY-128, or null without a context
     * @param array<array-key, mixed> $shared
     * @param array<string, array<array-key, mixed>> $regions region data by region name
     * @param array<string, array<string, mixed>> $kept kept values by region name and path
     * @return array<string, mixed>
     */
    public static function value(
        string $timezone,
        string $route,
        array $params,
        string $build,
        ?array $context,
        array $shared,
        array $regions,
        array $kept = [],
    ): array {
        $encoded = [];
        foreach ($regions as $name => $data) {
            $encoded[$name] = self::map($data);
        }

        $value = [
            'env' => ['timezone' => $timezone],
            'route' => $route,
            'params' => self::map($params),
            'build' => $build,
        ];
        // HY-128: the member context follows build, and an application without a context has none.
        if ($context !== null) {
            $value['context'] = $context;
        }

        return [
            ...$value,
            'shared' => self::map($shared),
            'regions' => self::map($encoded),
            'kept' => self::map($kept),
        ];
    }

    /**
     * Returns the JSON text of a value of the data model: rules.json_write of the core (HY-54.18, HY-54.19). A value
     * that has no JSON form fails with the kind of the data model, as the core raises it (HY-44).
     */
    public static function encode(mixed $value): string
    {
        // rules.json_write takes no `JsonSerializable`, so the value of each is written (HY-44.6).
        return CoreRules::shared()->jsonCodecEncode(DataModel::plain($value));
    }

    /**
     * Reads a JSON text to a value of the data model in document order: rules.json_read of the core (HY-54.20). A
     * list is an array with sequence keys, a map a `stdClass` or an array whose keys are not a sequence, and a
     * number a float; isList and mapEntries read them. A text that json refuses
     * fails with the kind `malformed_json`, and a value outside the data model with the kind
     * of the data model, as the core raises them (HY-54.21).
     *
     * @throws HyperValueError
     */
    public static function decode(string $text): mixed
    {
        return CoreRules::shared()->jsonCodecDecode($text);
    }

    /**
     * Returns true when a value that the core gives is a list: an array with sequence keys, the empty array
     * included. The core gives a list as such an array (HY-54.20).
     *
     * @phpstan-assert-if-true list<mixed> $value
     */
    public static function isList(mixed $value): bool
    {
        return is_array($value) && array_is_list($value);
    }

    /**
     * Returns the entries of a map that the core gives, or null for another value. The core gives a map as a
     * `stdClass` or as an array whose keys are not a sequence (HY-54.20).
     *
     * @return array<array-key, mixed>|null
     */
    public static function mapEntries(mixed $value): ?array
    {
        return match (true) {
            $value instanceof \stdClass => get_object_vars($value),
            is_array($value) && !array_is_list($value) => $value,
            default => null,
        };
    }

    /**
     * @param array<array-key, mixed> $value
     * @return array<array-key, mixed>|\stdClass
     */
    private static function map(array $value): array|\stdClass
    {
        return $value === [] ? new \stdClass() : $value;
    }
}
