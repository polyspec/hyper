import { MapLoader, type Engine, type MapValue, type Value } from '@polyspec/template/render';
import { createEngine } from './engine.js';
import { checkManifest, DATA_TEMPLATE_NAME, pageRegion, type Manifest, type RouteDeclaration } from './manifest.js';
import { Router } from './router.js';
import { TemplateStore, type TemplateFetcher, type TemplateIndex } from './templates.js';

// The manifest, its router, the template store and the engine of one application.
export interface Application {
  manifest: Manifest;
  router: Router;
  templates: TemplateStore;
  engine: Engine;
  page: string;
}

// A JSON response after its shape and its route were checked (HY-17, HY-20).
export interface DecodedResponse {
  value: MapValue;
  route: RouteDeclaration;
  params: MapValue;
  timezone: string;
  shared: MapValue;
  regions: MapValue;
}

// The parts of a JSON response rendered alone (HY-13), in response order.
export interface RenderedParts {
  route: RouteDeclaration;
  title: string;
  regions: Map<string, string>;
}

// Creates an application from its manifest, its template index and the function that fetches template files.
export function createApplication(manifest: Manifest, index: TemplateIndex, fetcher: TemplateFetcher): Application {
  checkManifest(manifest);
  const loader = new MapLoader();
  return {
    manifest,
    router: new Router(manifest.routes),
    templates: new TemplateStore(index, fetcher, loader),
    engine: createEngine(loader),
    page: pageRegion(manifest),
  };
}

// Checks the response shape and that the browser router selects the route that the server reported (HY-17, HY-20).
export function decodeResponse(app: Application, response: Value, path: string): DecodedResponse {
  const root = requireMap(response, 'response');
  const timezone = requireMap(root.get('env') ?? null, 'env').get('timezone');
  if (typeof timezone !== 'string') throw new Error('hyper: env.timezone is not a string');
  const match = app.router.match(path);
  const name = root.get('route');
  if (match === null || match.name !== name) {
    throw new Error(`hyper: browser route ${JSON.stringify(match?.name ?? null)} for ${path} differs from server route ${JSON.stringify(name)}`);
  }
  return {
    value: root,
    route: app.manifest.routes.find((item) => item.name === match.name)!,
    params: requireMap(root.get('params') ?? null, 'params'),
    timezone,
    shared: requireMap(root.get('shared') ?? null, 'shared'),
    regions: requireMap(root.get('regions') ?? null, 'regions'),
  };
}

// Returns the template of a manifest region, the page region or a route region of a route.
export function regionTemplate(app: Application, route: RouteDeclaration, name: string): string {
  if (name === app.page) return route.template;
  const template = app.manifest.regions.find((item) => item.name === name)?.template
    ?? route.regions?.find((item) => item.name === name)?.template;
  if (template === undefined) throw new Error(`hyper: region ${JSON.stringify(name)} is not in the manifest or the route ${route.name}`);
  return template;
}

// Renders one region alone with merge(shared, data) as root data; the page region receives the route regions as definitions (HY-13, HY-30).
export function renderRegion(app: Application, route: RouteDeclaration, name: string, shared: MapValue, regions: MapValue, timezone: string): string {
  const root: MapValue = new Map(shared);
  for (const [key, item] of requireMap(regions.get(name) ?? null, `region ${name}`)) root.set(key, item);
  const define: Record<string, { template: string; data: Value }> = {};
  if (name === app.page) {
    for (const region of route.regions ?? []) {
      define[region.name] = { template: region.template, data: requireMap(regions.get(region.name) ?? null, `region ${region.name}`) };
    }
  }
  return app.engine.render(regionTemplate(app, route, name), root, { define, env: { timezone } });
}

// Renders the title and every region of a decoded response alone (HY-13).
export function renderParts(app: Application, decoded: DecodedResponse): RenderedParts {
  const regions = new Map<string, string>();
  for (const name of decoded.regions.keys()) {
    regions.set(name, renderRegion(app, decoded.route, name, decoded.shared, decoded.regions, decoded.timezone));
  }
  const title = app.engine.render(app.manifest.title, decoded.shared, { env: { timezone: decoded.timezone } });
  return { route: decoded.route, title, regions };
}

// Converts a decoded region response into the HTML that htmx swaps (HY-21). Route regions are inside the page region.
export function toHtml(app: Application, decoded: DecodedResponse): string {
  const { title, regions } = renderParts(app, decoded);
  const page = regions.get(app.page);
  if (page === undefined) throw new Error(`hyper: response has no region ${app.page}`);
  const routeRegions = new Set((decoded.route.regions ?? []).map((region) => region.name));
  let html = `<title>${title}</title>${page}`;
  for (const [name, region] of regions) {
    if (name !== app.page && !routeRegions.has(name)) html += `<hx-partial hx-target="#${name}" hx-swap="innerMorph">${region}</hx-partial>`;
  }
  return html;
}

// Renders the document of a decoded document response, including the embedded data (HY-12, HY-22, HY-31).
export function renderDocument(app: Application, decoded: DecodedResponse): string {
  const define: Record<string, { template: string; data: Value } | string> = {
    layout: app.manifest.layout,
    title: app.manifest.title,
    data: { template: DATA_TEMPLATE_NAME, data: new Map([['response', decoded.value]]) },
  };
  for (const name of [...app.manifest.regions.map((region) => region.name), ...(decoded.route.regions ?? []).map((region) => region.name)]) {
    const data = decoded.regions.get(name);
    if (data === undefined) throw new Error(`hyper: document response has no region ${name}`);
    define[name] = { template: regionTemplate(app, decoded.route, name), data };
  }
  return app.engine.render('layout', decoded.shared, { define, env: { timezone: decoded.timezone } });
}

export function requireMap(value: Value, label: string): MapValue {
  if (!(value instanceof Map)) throw new Error(`hyper: ${label} is not an object`);
  return value;
}
