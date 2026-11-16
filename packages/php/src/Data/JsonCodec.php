<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The JSON text of the servers (HY-17, HY-54): the JSON response value, its text with the bytes of `json_encode` with
 * `JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES`, and the reading of a JSON text with rules.json_read of the core.
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
     * Returns the JSON text of a value; a number that is not finite or a string that is not UTF-8 fails (HY-44).
     *
     * @throws \JsonException
     */
    public static function encode(mixed $value): string
    {
        return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    /**
     * Reads a JSON text to a value of the data model with `stdClass` maps in document order: rules.json_read of the
     * core (HY-54.20). A text that json refuses fails with the kind `malformed_json`, and a value outside the data
     * model with the kind of the data model, as the core raises them (HY-54.21).
     *
     * @throws HyperValueError
     */
    public static function decode(string $text): mixed
    {
        return CoreRules::shared()->jsonCodecDecode($text);
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
