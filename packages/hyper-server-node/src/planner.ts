// Selects the regions that a response contains (HY-11, HY-18, HY-19).
import { stripBasePath, type Manifest, type RegionDeclaration } from '@polyspec/hyper-client';
import type { Request } from './request.js';
import type { Flash } from './session.js';

// Returns the changed topics: the topics of the previous action, and `path` after navigation (HY-11).
export function changedTopics(request: Request, flash: Flash, basePath: string): string[] {
  const topics = [...flash.changed];
  const current = request.currentPath();
  if (current !== null && (stripBasePath(current, basePath) ?? current) !== request.path()) topics.push('path');
  return [...new Set(topics)];
}

// Returns every region in manifest order for a document, and the page region followed by the regions that use a
// changed topic for a region request.
export function selectRegions(manifest: Manifest, document: boolean, changed: readonly string[]): RegionDeclaration[] {
  if (document) return manifest.regions;
  const page = manifest.regions.find((region) => region.page === true)!;
  return [page, ...manifest.regions.filter((region) => region.page !== true && (region.uses ?? []).some((topic) => changed.includes(topic)))];
}
