// The changed topics of a request (HY-11), from which the core selects the regions of a response (HY-18, HY-19).
import { stripBasePath } from '@polyspec/hyper-client';
import type { Request } from '../http/request.js';
import type { Flash } from '../session/flash.js';

/** @internal */
export class RegionPlanner {
  // Returns the changed topics: the topics of the previous action, and `path` after navigation (HY-11).
  static changedTopics(request: Request, flash: Flash, basePath: string): string[] {
    const topics = [...flash.changed];
    const current = request.currentPath();
    if (current !== null && (stripBasePath(current, basePath) ?? current) !== request.path()) topics.push('path');
    return [...new Set(topics)];
  }
}
