// The application manifest (HY-1, HY-2).

export interface RegionDeclaration {
  name: string;
  page?: boolean;
  template?: string;
  uses?: string[];
}

export interface RouteDeclaration {
  name: string;
  path: string;
  title: string;
  template: string;
  post?: boolean;
}

export interface Manifest {
  layout: string;
  title: string;
  regions: RegionDeclaration[];
  routes: RouteDeclaration[];
}

const REGION_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

// Checks the manifest rules that the browser code relies on and returns the manifest.
export function checkManifest(manifest: Manifest): Manifest {
  const regionNames = new Set<string>();
  let pages = 0;
  for (const region of manifest.regions) {
    if (!REGION_NAME.test(region.name) || region.name === 'layout' || region.name === 'title' || regionNames.has(region.name)) {
      throw new Error(`hyper: invalid region name ${JSON.stringify(region.name)}`);
    }
    regionNames.add(region.name);
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
  }
  return manifest;
}

// Returns the page region name.
export function pageRegion(manifest: Manifest): string {
  return manifest.regions.find((region) => region.page === true)!.name;
}
