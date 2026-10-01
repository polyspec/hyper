<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** Builds and encodes the JSON response value (HY-17). */
final class JsonEncoder
{
    /**
     * Returns the response value; empty maps are `stdClass` so that JSON encoding and template binding both see maps.
     *
     * @param array<string, string> $params
     * @param array<string, mixed> $shared
     * @param array<string, array<string, mixed>> $regions region data by region name
     * @return array<string, mixed>
     */
    public static function value(string $timezone, string $route, array $params, array $shared, array $regions): array
    {
        $encoded = [];
        foreach ($regions as $name => $data) {
            $encoded[$name] = self::map($data);
        }

        return [
            'env' => ['timezone' => $timezone],
            'route' => $route,
            'params' => self::map($params),
            'shared' => self::map($shared),
            'regions' => self::map($encoded),
        ];
    }

    /** @param array<string, mixed> $value */
    public static function encode(array $value): string
    {
        return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    private static function map(array $value): array|\stdClass
    {
        return $value === [] ? new \stdClass() : $value;
    }
}
