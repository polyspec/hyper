<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** Encodes the JSON response (HY-17). */
final class JsonEncoder
{
    /**
     * @param array<string, string> $params
     * @param array<string, mixed> $shared
     * @param array<string, array<string, mixed>> $regions region data by region name
     */
    public static function encode(string $timezone, string $route, array $params, array $shared, array $regions): string
    {
        $encoded = [];
        foreach ($regions as $name => $data) {
            $encoded[$name] = self::map($data);
        }

        return json_encode(
            [
                'env' => ['timezone' => $timezone],
                'route' => $route,
                'params' => self::map($params),
                'shared' => self::map($shared),
                'regions' => self::map($encoded),
            ],
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR,
        );
    }

    /** Encodes an empty PHP array as a JSON object, because these positions are maps. */
    private static function map(array $value): array|\stdClass
    {
        return $value === [] ? new \stdClass() : $value;
    }
}
