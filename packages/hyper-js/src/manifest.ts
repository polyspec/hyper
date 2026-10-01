// The application manifest (HY-1, HY-2, HY-30).
import dataTemplate from './data-template.json';

export interface RegionDeclaration {
  name: string;
  page?: boolean;
  template?: string;
  uses?: string[];
}

export interface RouteRegionDeclaration {
  name: string;
  template: string;
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

// The reserved template that embeds the document data (HY-31).
export const DATA_TEMPLATE_NAME: string = dataTemplate.name;
export const DATA_TEMPLATE_SOURCE: string = dataTemplate.source;

const REGION_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;
const RESERVED = new Set(['layout', 'title', 'data']);

// Checks the manifest rules that the browser code relies on and returns the manifest.
export function checkManifest(manifest: Manifest): Manifest {
  const regionNames = new Set<string>();
  const addRegion = (name: string): void => {
    if (!REGION_NAME.test(name) || RESERVED.has(name) || regionNames.has(name)) {
      throw new Error(`hyper: invalid or duplicated region name ${JSON.stringify(name)}`);
    }
    regionNames.add(name);
  };
  let pages = 0;
  for (const region of manifest.regions) {
    addRegion(region.name);
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
    for (const region of route.regions ?? []) addRegion(region.name);
  }
  return manifest;
}

// Returns the page region name.
export function pageRegion(manifest: Manifest): string {
  return manifest.regions.find((region) => region.page === true)!.name;
}
