import { MapLoader, type Engine, type MapValue, type Value } from '@polyspec/template/render';
import { createEngine } from './engine.js';
import { applyKept } from './keep.js';
import { DATA_TEMPLATE_NAME, keptPaths, pageRegion, type Manifest, type RouteDeclaration } from './manifest.js';
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
  // the loader data of every region in the response (HY-17)
  loader: MapValue;
  // the region data that renders: the loader data with kept values applied (HY-38)
  regions: MapValue;
  // the regions whose data has kept values applied
  kept: Set<string>;
  // the regions whose kept values were removed because they broke rendering (HY-38)
  dropped: Set<string>;
}

// The parts of a JSON response rendered alone (HY-13), in response order.
export interface RenderedParts {
  route: RouteDeclaration;
  title: string;
  regions: Map<string, string>;
}

// Creates an application from its manifest, its template index and the function that fetches template files.
// It does not check the manifest: the asset build checks the manifest that a bundle contains, and a server checks
// its manifest with checkManifest when it starts (HY-2).
export function createApplication(manifest: Manifest, index: TemplateIndex, fetcher: TemplateFetcher): Application {
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
  const loader = requireMap(root.get('regions') ?? null, 'regions');
  const decoded: DecodedResponse = {
    value: root,
    route: app.manifest.routes.find((item) => item.name === match.name)!,
    params: requireMap(root.get('params') ?? null, 'params'),
    timezone,
    shared: requireMap(root.get('shared') ?? null, 'shared'),
    loader,
    // A copy: kept values change these regions, never the server value (HY-31, HY-38).
    regions: requireMap(copyValue(loader), 'regions'),
    kept: new Set(),
    dropped: new Set(),
  };
  // The server sends server and cookie values; the browser applies only those kinds from it (HY-17, HY-38).
  for (const [name, values] of requireMap(root.get('kept') ?? null, 'kept')) {
    const kinds = keptPaths(app.manifest, name);
    const pairs = [...requireMap(values, `kept ${name}`)].filter(([path]) => kinds[path] === 'server' || kinds[path] === 'cookie');
    applyRegionKept(decoded, name, pairs);
  }
  return decoded;
}

// Applies kept values to the data of one region of a decoded response and returns the applied paths (HY-38).
export function applyRegionKept(decoded: DecodedResponse, name: string, pairs: readonly (readonly [string, Value])[]): string[] {
  const data = decoded.regions.get(name);
  if (!(data instanceof Map)) return [];
  const applied = applyKept(data, pairs);
  if (applied.length > 0) decoded.kept.add(name);
  return applied;
}

// Runs a rendering of a decoded response. When it fails, every region whose rendering alone fails with its
// kept values returns to its loader data, route regions first, and the rendering runs again (HY-38).
function withKeptCheck<T>(app: Application, decoded: DecodedResponse, render: () => T): T {
  try {
    return render();
  } catch (error) {
    if (decoded.kept.size === 0) throw error;
  }
  const routeRegions = (decoded.route.regions ?? []).map((region) => region.name);
  const others = [...decoded.regions.keys()].filter((name) => name !== app.page && !routeRegions.includes(name));
  for (const name of [...routeRegions, ...others, app.page]) {
    if (!decoded.kept.has(name)) continue;
    try {
      renderRegion(app, decoded.route, name, decoded.shared, decoded.regions, decoded.timezone);
    } catch {
      decoded.regions.set(name, copyValue(decoded.loader.get(name) ?? null));
      decoded.kept.delete(name);
      decoded.dropped.add(name);
    }
  }
  return render();
}

// Returns a deep copy of a value whose maps and lists can be changed independently.
export function copyValue(value: Value): Value {
  if (value instanceof Map) return new Map([...value].map(([key, item]) => [key, copyValue(item)]));
  if (Array.isArray(value)) return value.map(copyValue);
  return value;
}

// Returns the template of a manifest region, the page region or a route region of a route.
export function regionTemplate(app: Application, route: RouteDeclaration, name: string): string {
  if (name === app.page) return route.template;
  const template = app.manifest.regions.find((item) => item.name === name)?.template
    ?? route.regions?.find((item) => item.name === name)?.template;
  if (template === undefined) throw new Error(`hyper: region ${JSON.stringify(name)} is not in the manifest or the route ${route.name}`);
  return template;
}

// Renders one region alone with merge(shared, data) as root data; the page region receives each route
// region rendered alone as an HTML definition (HY-13, HY-30).
export function renderRegion(app: Application, route: RouteDeclaration, name: string, shared: MapValue, regions: MapValue, timezone: string): string {
  const root: MapValue = new Map(shared);
  for (const [key, item] of requireMap(regions.get(name) ?? null, `region ${name}`)) root.set(key, item);
  const define: Record<string, { html: string }> = {};
  if (name === app.page) {
    for (const region of route.regions ?? []) define[region.name] = { html: renderRegion(app, route, region.name, shared, regions, timezone) };
  }
  return app.engine.render(regionTemplate(app, route, name), root, { define, env: { timezone } });
}

// Renders the title and every region of a decoded response alone (HY-13, HY-38).
export function renderParts(app: Application, decoded: DecodedResponse): RenderedParts {
  const regions = withKeptCheck(app, decoded, () => {
    const rendered = new Map<string, string>();
    for (const name of decoded.regions.keys()) {
      rendered.set(name, renderRegion(app, decoded.route, name, decoded.shared, decoded.regions, decoded.timezone));
    }
    return rendered;
  });
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

// Renders the document of a decoded document response, including the embedded data, which carries the
// loader data and the server kept values that were applied (HY-12, HY-22, HY-31, HY-38).
export function renderDocument(app: Application, decoded: DecodedResponse): string {
  const names = [...app.manifest.regions.map((region) => region.name), ...(decoded.route.regions ?? []).map((region) => region.name)];
  for (const name of names) {
    if (!decoded.regions.has(name)) throw new Error(`hyper: document response has no region ${name}`);
  }
  return withKeptCheck(app, decoded, () => {
    const env = { timezone: decoded.timezone };
    // Every definition is HTML: the title, the embedded data and each manifest region rendered alone (HY-12).
    const define: Record<string, { html: string }> = {
      title: { html: app.engine.render(app.manifest.title, decoded.shared, { env }) },
      data: { html: app.engine.render(DATA_TEMPLATE_NAME, new Map([['response', embedded(decoded)]]), { env }) },
    };
    for (const region of app.manifest.regions) define[region.name] = { html: renderRegion(app, decoded.route, region.name, decoded.shared, decoded.regions, decoded.timezone) };
    return app.engine.render(app.manifest.layout, decoded.shared, { define, env });
  });
}

// Returns the response value without the kept values of the regions that dropped them (HY-31, HY-38).
function embedded(decoded: DecodedResponse): MapValue {
  if (decoded.dropped.size === 0) return decoded.value;
  const kept = requireMap(decoded.value.get('kept') ?? null, 'kept');
  return new Map([...decoded.value, ['kept', new Map([...kept].filter(([name]) => !decoded.dropped.has(name)))]]);
}

export function requireMap(value: Value, label: string): MapValue {
  if (!(value instanceof Map)) throw new Error(`hyper: ${label} is not an object`);
  return value;
}
