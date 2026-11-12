// The checks of an application's declarations when it opens: the client rendering against the manifest (HY-62) and the
// handlers against the manifest (HY-2, HY-30). The app calls them in `open`.
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { type Manifest } from '@polyspec/hyper-client';
import type { Handlers } from './app.js';
import type { ClientRendering } from './client-rendering.js';

// The client rendering as the app keeps it: the data base path, the bytes of its shell and its selection.
export interface Client {
  basePath: string;
  shell: string;
  selects: ClientRendering['selects'];
}

// Reads the static shell after checking the declaration of the client rendering against the manifest (HY-62).
export function checkClient(client: ClientRendering, manifest: Manifest): Client {
  const base = client.basePath;
  if (base === '' || !base.startsWith('/') || base.endsWith('/')) throw new Error(`hyper: data base path ${base} must start with / and must not end with /`);
  for (const route of manifest.routes) {
    if (route.path === base || route.path.startsWith(`${base}/`)) throw new Error(`hyper: route ${route.name} lies under the data base path ${base}`);
  }
  if (!isAbsolute(client.shell)) throw new Error(`hyper: static shell ${client.shell} is not an absolute path`);
  const shell = readFileSync(client.shell, 'utf8');
  if (!shell.includes(`<meta name="hyper-api" content="${escapeAttribute(base)}">`)) throw new Error(`hyper: static shell ${client.shell} does not declare the data base path ${base}`);
  return { basePath: base, shell, selects: client.selects };
}

// Escapes a value as PHP htmlspecialchars with ENT_QUOTES does.
function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#039;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Checks that the handlers match the manifest (HY-2, HY-30).
export function checkHandlers<S extends object>(manifest: Manifest, handlers: Handlers<S>): void {
  for (const name of Object.keys(handlers.regions ?? {})) {
    const region = manifest.regions.find((item) => item.name === name);
    if (region === undefined || region.page === true) throw new Error(`hyper: region loader ${name} has no non-page region in the manifest`);
  }
  for (const [name, handler] of Object.entries(handlers.routes ?? {})) {
    const route = manifest.routes.find((item) => item.name === name);
    if (route === undefined) throw new Error(`hyper: route handler ${name} has no route in the manifest`);
    if ((handler.post !== undefined) !== (route.post === true)) throw new Error(`hyper: route ${name} must have a POST action exactly when the manifest declares post`);
    const routeRegions = (route.regions ?? []).map((region) => region.name);
    for (const regionName of Object.keys(handler.regions ?? {})) {
      if (!routeRegions.includes(regionName)) throw new Error(`hyper: route ${name} has a loader for undeclared region ${regionName}`);
    }
  }
  for (const route of manifest.routes) {
    if (route.post === true && handlers.routes?.[route.name]?.post === undefined) throw new Error(`hyper: route ${route.name} declares post but has no POST action`);
  }
}
