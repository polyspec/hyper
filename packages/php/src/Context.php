<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The context of an application (HY-124 to HY-128): the map that its handler returns, its JSON text (HY-54), its hash
 * with the build (HY-125), the member `context` of a JSON response, the check of the `Hyper-Context` header and the
 * place of the context in the shared data of a document (HY-10).
 *
 * @internal
 */
final class Context
{
    /**
     * Calls the context handler with the selection value and returns its map, which belongs to the data model; a value
     * that is not a map, or that holds a value outside the data model, fails (HY-124, HY-44, HY-43).
     *
     * @return array<array-key, mixed>
     */
    public static function held(\Closure $handler, mixed $selection): array
    {
        $value = $handler($selection);
        if (!is_array($value) || ($value !== [] && array_is_list($value))) {
            throw new \LogicException('the context handler did not return a map (HY-124)');
        }
        DataModel::check(['context' => $value]);

        return $value;
    }

    /**
     * Returns the JSON text of HY-54 of a context map. An empty map is an object (HY-17).
     *
     * @param array<array-key, mixed> $map
     */
    public static function text(array $map): string
    {
        return JsonCodec::encode($map === [] ? new \stdClass() : $map);
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

        return $held === $hash ? ['hash' => $hash] : ['hash' => $hash, 'value' => $map === [] ? new \stdClass() : $map];
    }

    /** Returns true for a request without `Hyper-Context` or with a context hash, 64 lowercase hexadecimal (HY-127). */
    public static function validHeader(?string $value): bool
    {
        return $value === null || preg_match('/^[0-9a-f]{64}$/D', $value) === 1;
    }

    /**
     * Returns the shared data of a document with the context in its place (HY-10): after `csrf`, and when HY-73
     * removed `csrf`, right after `title`; and first when they removed both. Shared data that already holds a member
     * `context` fails, because the context has one place and one source (HY-124, HY-128).
     *
     * @param array<array-key, mixed> $shared
     * @param array<array-key, mixed> $map
     * @return array<array-key, mixed>
     */
    public static function withContext(array $shared, array $map): array
    {
        if (array_key_exists('context', $shared)) {
            throw new \LogicException('the shared data already holds the member context (HY-128)');
        }
        $anchor = array_key_exists('csrf', $shared) ? 'csrf' : 'title';
        $placed = [];
        $found = false;
        foreach ($shared as $name => $value) {
            $placed[$name] = $value;
            if ($name === $anchor) {
                $placed['context'] = $map;
                $found = true;
            }
        }

        // The union keeps the integer keys of the shared data, which a spread would number again.
        return $found ? $placed : ['context' => $map] + $placed;
    }
}
