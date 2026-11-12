<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server;

/**
 * The JSON text of the servers (HY-17, HY-54): the JSON response value, its text with the bytes of `json_encode` with
 * `JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES`, and the decoding of kept values with `json_decode`.
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
     * Decodes JSON text with `stdClass` maps in document order (HY-54). A number outside ±(2^53 − 1) or one that is not
     * finite decodes, and `inDataModel` finds it outside the data model. Invalid text, a lone surrogate escape, a key
     * that starts with U+0000 or nesting deeper than 511 containers fails.
     *
     * @throws JsonDecodeError
     */
    public static function decode(string $text): mixed
    {
        try {
            return json_decode($text, false, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException $error) {
            throw new JsonDecodeError('hyper: ' . $error->getMessage(), 0, $error);
        }
    }

    /**
     * Returns true when a decoded value is a value of the data model (HY-44, HY-54): a number outside ±(2^53 − 1) or
     * one that is not finite, and nesting deeper than the data model allows, are not.
     */
    public static function inDataModel(mixed $value): bool
    {
        return DataModel::contains($value);
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
