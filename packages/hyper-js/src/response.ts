import type { Engine, MapValue, Template, Value } from '@polyspec/template/render';
import { createEngine } from './engine.js';
import { checkManifest, pageRegion, type Manifest, type RouteDeclaration } from './manifest.js';
import { Router } from './router.js';

// The manifest, its router and the template engine of one application.
export interface Application {
  manifest: Manifest;
  router: Router;
  engine: Engine;
  page: string;
}

// The parts of a JSON response rendered alone (HY-13), in response order.
export interface RenderedParts {
  route: RouteDeclaration;
  title: string;
  regions: Map<string, string>;
}

interface Decoded {
  route: RouteDeclaration;
  timezone: string;
  shared: MapValue;
  regions: MapValue;
}

// Creates an application from its manifest and its parsed templates.
export function createApplication(manifest: Manifest, templates: Record<string, Template>): Application {
  checkManifest(manifest);
  return { manifest, router: new Router(manifest.routes), engine: createEngine(templates), page: pageRegion(manifest) };
}

// Renders the title and every region of a JSON response alone (HY-13, HY-20).
export function renderParts(app: Application, response: Value, path: string): RenderedParts {
  const decoded = decode(app, response, path);
  const env = { timezone: decoded.timezone };
  const regions = new Map<string, string>();
  for (const [name, data] of decoded.regions) {
    const root: MapValue = new Map(decoded.shared);
    for (const [key, item] of requireMap(data, `region ${name}`)) root.set(key, item);
    regions.set(name, app.engine.render(regionTemplate(app, decoded.route, name), root, { env }));
  }
  const title = app.engine.render(app.manifest.title, decoded.shared, { env });
  return { route: decoded.route, title, regions };
}

// Converts a JSON region response into the HTML that htmx swaps (HY-21).
export function toHtml(app: Application, response: Value, path: string): string {
  const { title, regions } = renderParts(app, response, path);
  const page = regions.get(app.page);
  if (page === undefined) throw new Error(`hyper: response has no region ${app.page}`);
  let html = `<title>${title}</title>${page}`;
  for (const [name, region] of regions) {
    if (name !== app.page) html += `<hx-partial hx-target="#${name}" hx-swap="innerMorph">${region}</hx-partial>`;
  }
  return html;
}

// Renders the document of a JSON document response (HY-12, HY-22).
export function renderDocument(app: Application, response: Value, path: string): string {
  const decoded = decode(app, response, path);
  const define: Record<string, { template: string; data: Value } | string> = { layout: app.manifest.layout, title: app.manifest.title };
  for (const region of app.manifest.regions) {
    const data = decoded.regions.get(region.name);
    if (data === undefined) throw new Error(`hyper: document response has no region ${region.name}`);
    define[region.name] = { template: regionTemplate(app, decoded.route, region.name), data };
  }
  return app.engine.render('layout', decoded.shared, { define, env: { timezone: decoded.timezone } });
}

// Checks the response shape and that the browser router agrees with the server route (HY-17, HY-20).
function decode(app: Application, response: Value, path: string): Decoded {
  const root = requireMap(response, 'response');
  const timezone = requireMap(root.get('env') ?? null, 'env').get('timezone');
  if (typeof timezone !== 'string') throw new Error('hyper: env.timezone is not a string');
  const match = app.router.match(path);
  const name = root.get('route');
  if (match === null || match.name !== name) {
    throw new Error(`hyper: browser route ${JSON.stringify(match?.name ?? null)} for ${path} differs from server route ${JSON.stringify(name)}`);
  }
  const route = app.manifest.routes.find((item) => item.name === match.name)!;
  return {
    route,
    timezone,
    shared: requireMap(root.get('shared') ?? null, 'shared'),
    regions: requireMap(root.get('regions') ?? null, 'regions'),
  };
}

function regionTemplate(app: Application, route: RouteDeclaration, name: string): string {
  if (name === app.page) return route.template;
  const region = app.manifest.regions.find((item) => item.name === name);
  if (region?.template === undefined) throw new Error(`hyper: response region ${JSON.stringify(name)} is not in the manifest`);
  return region.template;
}

function requireMap(value: Value, label: string): MapValue {
  if (!(value instanceof Map)) throw new Error(`hyper: ${label} is not an object`);
  return value;
}
