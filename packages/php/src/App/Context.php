<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The context of an application (HY-124 to HY-128): the map that its handler returns, its JSON text (HY-54), its hash
 * with the build (HY-125) and the check of the `Hyper-Context` header (HY-127); the core places the context in the
 * shared data of a document (HY-10) and writes the member `context` of a JSON response (HY-128).
 *
 * @internal
 */
final class Context
{
    /**
     * Calls the context handler with the selection value and returns its map, which belongs to the data model; a value
     * that is not a map fails (HY-124, HY-43); the core checks its values when the page receives it (HY-44.10).
     *
     * @return array<array-key, mixed>
     */
    public static function held(\Closure $handler, mixed $selection): array
    {
        $value = $handler($selection);
        if (!is_array($value) || ($value !== [] && array_is_list($value))) {
            throw new \LogicException('the context handler did not return a map (HY-124)');
        }

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
        return CoreRules::shared()->contextHash($build, $text);
    }

    /** Returns true for a request without `Hyper-Context` or with a context hash, 64 lowercase hexadecimal (HY-127). */
    public static function validHeader(?string $value): bool
    {
        return CoreRules::shared()->contextValidHeader($value);
    }
}
