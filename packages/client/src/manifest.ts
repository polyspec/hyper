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

// The reserved template that embeds the document data (HY-31). Its source is in data-template.json, which the
// package exports as `@polyspec/hyper-client/data-template.json` for the builds; the client bundle carries only the name
// (HR-34).
export const DATA_TEMPLATE_NAME = 'hyper/data.tpl';

const REGION_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;
const RESERVED = new Set(['layout', 'title', 'data']);
const KEPT_PATH = /^[A-Za-z_][A-Za-z0-9_]*(\.([A-Za-z_][A-Za-z0-9_]*|\d+))*$/;

// Checks the manifest rules that the browser code relies on and returns the manifest. The manifest is JSON that a file or
// a response holds, so the check takes it as unknown and returns the declarations that it read.
export function checkManifest(manifest: unknown): Manifest {
  if (!isRecord(manifest) || typeof manifest.layout !== 'string' || typeof manifest.title !== 'string') throw new Error('hyper: the manifest has no layout or title template');
  const regionNames = new Set<string>();
  const addRegion = (name: unknown, keep: unknown, manifestRegion: boolean): { name: string; keep?: Record<string, KeepKind> } => {
    if (typeof name !== 'string' || !REGION_NAME.test(name) || RESERVED.has(name) || regionNames.has(name)) {
      throw new Error(`hyper: invalid or duplicated region name ${JSON.stringify(name)}`);
    }
    regionNames.add(name);
    if (keep === undefined) return { name };
    // HY-37: only route regions change in the browser, so only they keep values.
    if (manifestRegion) throw new Error(`hyper: manifest region ${name} cannot keep values; only route regions keep values`);
    if (!isRecord(keep)) throw new Error(`hyper: region ${name} has an invalid kept path ${JSON.stringify(keep)}`);
    const kept: Record<string, KeepKind> = {};
    for (const [path, kind] of Object.entries(keep)) {
      const keepKind = KEEP_KINDS.find((known) => known === kind);
      if (!KEPT_PATH.test(path) || keepKind === undefined) throw new Error(`hyper: region ${name} has an invalid kept path ${path}`);
      kept[path] = keepKind;
    }
    return { name, keep: kept };
  };
  let pages = 0;
  const regions: RegionDeclaration[] = [];
  for (const region of listOf(manifest.regions, 'regions')) {
    if (!isRecord(region)) throw new Error('hyper: the manifest has a region that is not an object');
    const declaration: RegionDeclaration = addRegion(region.name, region.keep, true);
    if (region.uses !== undefined) {
      const uses: string[] = [];
      for (const topic of listOf(region.uses, `uses of region ${declaration.name}`)) {
        if (typeof topic !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(topic)) throw new Error(`hyper: region ${declaration.name} uses an invalid topic ${JSON.stringify(topic)}`);
        uses.push(topic);
      }
      declaration.uses = uses;
    }
    if (region.page === true) {
      pages++;
      if (region.template !== undefined) throw new Error(`hyper: page region ${declaration.name} has a template`);
      declaration.page = true;
    } else if (typeof region.template !== 'string') {
      throw new Error(`hyper: region ${declaration.name} has no template`);
    } else {
      declaration.template = region.template;
    }
    regions.push(declaration);
  }
  if (pages !== 1) throw new Error('hyper: the manifest must declare exactly one page region');
  const routeNames = new Set<string>();
  const routes: RouteDeclaration[] = [];
  for (const route of listOf(manifest.routes, 'routes')) {
    if (!isRecord(route)) throw new Error('hyper: the manifest has a route that is not an object');
    const { name, title, template, path } = route;
    if (typeof name !== 'string' || name === '' || routeNames.has(name)) throw new Error(`hyper: duplicate or empty route name ${String(name)}`);
    if (typeof title !== 'string' || typeof template !== 'string') throw new Error(`hyper: route ${name} has no title or template`);
    routeNames.add(name);
    if (typeof path !== 'string') throw new Error(`hyper: route ${name} has no path`);
    if (path.startsWith('/_hyper')) throw new Error(`hyper: route ${name} uses the reserved path /_hyper`);
    const declaration: RouteDeclaration = { name, path, title, template };
    if (route.post !== undefined) {
      if (typeof route.post !== 'boolean') throw new Error(`hyper: route ${name} has a post that is not a boolean`);
      declaration.post = route.post;
    }
    if (route.regions !== undefined) {
      const routeRegions: RouteRegionDeclaration[] = [];
      for (const region of listOf(route.regions, `regions of route ${name}`)) {
        if (!isRecord(region)) throw new Error(`hyper: route ${name} has a region that is not an object`);
        const checked = addRegion(region.name, region.keep, false);
        if (typeof region.template !== 'string') throw new Error(`hyper: route region ${checked.name} has no template`);
        routeRegions.push({ ...checked, template: region.template });
      }
      declaration.regions = routeRegions;
    }
    routes.push(declaration);
  }
  return { layout: manifest.layout, title: manifest.title, regions, routes };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function listOf(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`hyper: the ${what} of the manifest are not a list`);
  return value;
}

// Returns the kept paths of a manifest region or of a route region of any route (HY-37).
export function keptPaths(manifest: Manifest, region: string): Record<string, KeepKind> {
  const declared = manifest.regions.find((item) => item.name === region)
    ?? manifest.routes.flatMap((route) => route.regions ?? []).find((item) => item.name === region);
  return declared?.keep ?? {};
}

// Returns the page region name.
export function pageRegion(manifest: Manifest): string {
  const page = manifest.regions.find((region) => region.page === true);
  if (page === undefined) throw new Error('hyper: the manifest must declare exactly one page region');
  return page.name;
}
