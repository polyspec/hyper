<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * Builds and encodes the JSON response value (HY-17).
 *
 * @internal
 */
final class JsonEncoder
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

    /** @param array<array-key, mixed>|\stdClass $value */
    public static function encode(array|\stdClass $value): string
    {
        return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
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
