<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The context of an application: its JSON text (HY-54), its hash (HY-125) and the member `context` of a JSON response
 * (HY-128).
 *
 * @internal
 */
final class Context
{
    /**
     * Returns the JSON text of HY-54 of a context map. An empty map is an object (HY-17).
     *
     * @param array<array-key, mixed> $map
     */
    public static function text(array $map): string
    {
        return JsonEncoder::encode(self::value($map));
    }

    /**
     * Returns the context hash: the lowercase hexadecimal SHA-256 digest of `{"build":"<build id>","context":`,
     * the JSON text of the context and `}` (HY-125).
     */
    public static function hash(string $build, string $text): string
    {
        return hash('sha256', '{"build":"' . $build . '","context":' . $text . '}');
    }

    /**
     * Returns the member `context` of a JSON response (HY-128): `hash`, and `value` unless the held hash of the request
     * equals the hash (HY-127). A document that embeds its data passes null, so it always has the value.
     *
     * @param array<array-key, mixed> $map
     * @return array{hash: string, value?: array<array-key, mixed>|\stdClass}
     */
    public static function member(string $build, array $map, ?string $held): array
    {
        $hash = self::hash($build, self::text($map));

        return $held === $hash ? ['hash' => $hash] : ['hash' => $hash, 'value' => self::value($map)];
    }

    /**
     * Returns the map as JSON text writes it: an empty map is an object.
     *
     * @param array<array-key, mixed> $map
     * @return array<array-key, mixed>|\stdClass
     */
    private static function value(array $map): array|\stdClass
    {
        return $map === [] ? new \stdClass() : $map;
    }
}
