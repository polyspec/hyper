<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** Selects the regions that a response contains (HY-18, HY-19). */
final class RegionPlanner
{
    /**
     * Returns the changed topics: the topics of the previous action, and `path` after navigation (HY-11).
     *
     * @return list<string>
     */
    public static function changedTopics(Request $request, Flash $flash, string $basePath): array
    {
        $topics = $flash->changed;
        $current = $request->currentPath();
        if ($current !== null) {
            $current = Router::stripBasePath($current, $basePath) ?? $current;
            if ($current !== $request->path()) {
                $topics[] = 'path';
            }
        }

        return array_values(array_unique($topics));
    }

    /**
     * Returns every region in manifest order for a document, and the page region followed by the
     * regions that use a changed topic for a region request.
     *
     * @param list<string> $changed
     * @return list<Region>
     */
    public static function select(Manifest $manifest, bool $document, array $changed): array
    {
        if ($document) {
            return $manifest->regions;
        }
        $regions = [$manifest->page];
        foreach ($manifest->regions as $region) {
            if (!$region->page && $region->usesAny($changed)) {
                $regions[] = $region;
            }
        }

        return $regions;
    }
}
