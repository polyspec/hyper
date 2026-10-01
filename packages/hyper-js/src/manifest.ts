// The application manifest (HY-1, HY-2, HY-30).
import { KEEP_KINDS, type KeepKind } from './keep.js';

export interface RegionDeclaration {
  name: string;
  page?: boolean;
  template?: string;
  uses?: string[];
  keep?: Record<string, KeepKind>;
}

export interface RouteRegionDeclaration {
  name: string;
  template: string;
  keep?: Record<string, KeepKind>;
}

export interface RouteDeclaration {
  name: string;
  path: string;
  title: string;
  template: string;
  post?: boolean;
  regions?: RouteRegionDeclaration[];
}

export interface Manifest {
  layout: string;
  title: string;
  regions: RegionDeclaration[];
  routes: RouteDeclaration[];
}

// The reserved template that embeds the document data (HY-31). Its source is in data-template.json,
// which the asset build reads; the client bundle carries only the name (HY-34).
export const DATA_TEMPLATE_NAME = 'hyper/data.tpl';

const REGION_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;
const RESERVED = new Set(['layout', 'title', 'data']);
const KEPT_PATH = /^[A-Za-z_][A-Za-z0-9_]*(\.([A-Za-z_][A-Za-z0-9_]*|\d+))*$/;

// Checks the manifest rules that the browser code relies on and returns the manifest.
export function checkManifest(manifest: Manifest): Manifest {
  const regionNames = new Set<string>();
  const addRegion = (name: string, keep: Record<string, KeepKind> | undefined, page: boolean): void => {
    if (!REGION_NAME.test(name) || RESERVED.has(name) || regionNames.has(name)) {
      throw new Error(`hyper: invalid or duplicated region name ${JSON.stringify(name)}`);
    }
    regionNames.add(name);
    if (page && keep !== undefined) throw new Error(`hyper: page region ${name} cannot keep values`);
    for (const [path, kind] of Object.entries(keep ?? {})) {
      if (!KEPT_PATH.test(path) || !KEEP_KINDS.includes(kind)) throw new Error(`hyper: region ${name} has an invalid kept path ${path}`);
    }
  };
  let pages = 0;
  for (const region of manifest.regions) {
    addRegion(region.name, region.keep, region.page === true);
    for (const topic of region.uses ?? []) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(topic)) throw new Error(`hyper: region ${region.name} uses an invalid topic ${JSON.stringify(topic)}`);
    }
    if (region.page === true) {
      pages++;
      if (region.template !== undefined) throw new Error(`hyper: page region ${region.name} has a template`);
    } else if (typeof region.template !== 'string') {
      throw new Error(`hyper: region ${region.name} has no template`);
    }
  }
  if (pages !== 1) throw new Error('hyper: the manifest must declare exactly one page region');
  const routeNames = new Set<string>();
  for (const route of manifest.routes) {
    if (routeNames.has(route.name)) throw new Error(`hyper: duplicate route name ${route.name}`);
    routeNames.add(route.name);
    if (route.path.startsWith('/_hyper')) throw new Error(`hyper: route ${route.name} uses the reserved path /_hyper`);
    for (const region of route.regions ?? []) addRegion(region.name, region.keep, false);
  }
  return manifest;
}

// Returns the kept paths of a manifest region or of a route region of any route (HY-37).
export function keptPaths(manifest: Manifest, region: string): Record<string, KeepKind> {
  const declared = manifest.regions.find((item) => item.name === region)
    ?? manifest.routes.flatMap((route) => route.regions ?? []).find((item) => item.name === region);
  return declared?.keep ?? {};
}

// Returns the page region name.
export function pageRegion(manifest: Manifest): string {
  return manifest.regions.find((region) => region.page === true)!.name;
}
