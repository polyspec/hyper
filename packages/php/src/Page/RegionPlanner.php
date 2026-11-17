<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The changed topics of a request (HY-11, HY-19), from which the core selects the regions of a response (HY-18).
 *
 * @internal
 */
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
}
