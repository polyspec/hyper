import { bind, parseJson, type ListValue, type MapValue, type Value } from '@polyspec/template/render';
import { decodeResponse, renderDocument, renderRegion, requireMap, toHtml, type Application, type DecodedResponse } from './response.js';
import { stripBasePath } from './router.js';
import { routeTemplates } from './templates.js';
import type { RouteDeclaration } from './manifest.js';

// The htmx operations that the browser code uses.
export interface HtmxApi {
  process(element: Element): void;
  swap(ctx: { text: string; target: Element; swap: string; sourceElement: Element }): Promise<unknown>;
}

// The part of an htmx 4 request context that the extension reads and writes.
export interface RequestContext {
  target?: unknown;
  request: { action: string; method?: string; headers: Record<string, string> };
  response?: { raw?: { url: string }; headers: { get(name: string): string | null } };
  text?: string;
  fetch?: (url: string, init: unknown) => Promise<Response>;
  hyperRegion?: string;
}

export interface HookDetail {
  ctx: RequestContext;
}

export interface HyperExtension {
  htmx_config_request(elt: unknown, detail: HookDetail): void;
  htmx_before_request(elt: unknown, detail: HookDetail): void;
  htmx_after_request(elt: unknown, detail: HookDetail): void;
  htmx_before_history_update(elt: unknown, detail: { history: { type: string; path: string } }): void;
  htmx_before_history_restore(elt: unknown, detail: { path: string }): boolean;
}

// The data of the last rendered response (HY-32).
interface Held {
  route: RouteDeclaration;
  timezone: string;
  shared: MapValue;
  regions: MapValue;
}

export interface HyperOptions {
  // The base path of the server for client-side rendering; empty for server-side rendering (HY-22, HY-23).
  basePath: string;
  // Returns the element of a region; the default reads the document.
  element?: (id: string) => Element | null;
  // Performs requests for client-side rendering; the default is the global fetch.
  fetch?: typeof fetch;
}

// Holds region data and renders regions from it (HY-29 to HY-35).
export class Hyper {
  private held: Held | null = null;
  private readonly element: (id: string) => Element | null;
  private readonly request: typeof fetch;

  constructor(readonly app: Application, private readonly htmx: HtmxApi, private readonly options: HyperOptions) {
    this.element = options.element ?? ((id) => document.getElementById(id));
    this.request = options.fetch ?? ((input, init) => fetch(input, init));
  }

  // Holds the data of a rendered response; regions of an earlier route are replaced by the new route (HY-32).
  hold(decoded: DecodedResponse): void {
    const regions: MapValue = new Map();
    if (this.held !== null) {
      const dropped = new Set([this.app.page, ...(this.held.route.regions ?? []).map((region) => region.name)]);
      for (const [name, data] of this.held.regions) if (!dropped.has(name)) regions.set(name, data);
    }
    for (const [name, data] of decoded.regions) regions.set(name, data);
    this.held = { route: decoded.route, timezone: decoded.timezone, shared: decoded.shared, regions };
  }

  // Holds the data that the server embedded in the document and starts loading the templates of its route (HY-31, HY-32, HY-35).
  holdEmbedded(text: string, path: string): Promise<void> {
    const decoded = decodeResponse(this.app, parseJson(text), path);
    this.hold(decoded);
    return this.app.templates.ensure(routeTemplates(this.app.manifest, decoded.route));
  }

  // Returns the held data of a region (HY-33).
  data(region: string): Value | undefined {
    return this.held?.regions.get(region);
  }

  // Replaces the held data of a region and renders the region (HY-33).
  async render(region: string, data: unknown): Promise<void> {
    const held = this.requireHeld();
    held.regions.set(region, requireMap(bind(data), `data of region ${region}`));
    await this.renderHeld(region);
  }

  // Sets one value in the held data of a region by a dotted path and renders the region (HY-33).
  async set(region: string, path: string, value: unknown): Promise<void> {
    const held = this.requireHeld();
    const keys = path.split('.');
    let container: Value | undefined = held.regions.get(region);
    for (const key of keys.slice(0, -1)) container = child(container, key, path);
    assign(container, keys[keys.length - 1]!, bind(value), path);
    await this.renderHeld(region);
  }

  // Runs the assignments of a `hy-set` attribute in the region that contains the element (HY-36).
  async setFrom(element: Element): Promise<void> {
    const region = element.closest('[hy-region]')?.id;
    if (region === undefined || region === '') throw new Error('hyper: hy-set is outside a region');
    const held = this.requireHeld();
    for (const { path, value } of parseAssignments(element.getAttribute('hy-set') ?? '')) {
      const keys = path.split('.');
      let container: Value | undefined = held.regions.get(region);
      for (const key of keys.slice(0, -1)) container = child(container, key, path);
      assign(container, keys[keys.length - 1]!, bind(value), path);
    }
    await this.renderHeld(region);
  }

  // Renders the document of a path in the browser and replaces the title and the body (HY-22, HY-35).
  async renderLocation(location: string): Promise<void> {
    const url = new URL(location, window.location.origin);
    const match = this.app.router.match(url.pathname);
    if (match === null) {
      replaceBody(document.createTextNode('Not Found'));
      return;
    }
    const route = this.app.manifest.routes.find((item) => item.name === match.name)!;
    const [response] = await Promise.all([
      this.request(this.options.basePath + url.pathname + url.search, { headers: { Accept: 'application/json' }, credentials: 'same-origin' }),
      this.app.templates.ensure(routeTemplates(this.app.manifest, route)),
    ]);
    const text = await response.text();
    if (!(response.headers.get('content-type') ?? '').startsWith('application/json')) {
      replaceBody(document.createTextNode(text));
      return;
    }
    const decoded = decodeResponse(this.app, parseJson(text), url.pathname);
    const parsed = new DOMParser().parseFromString(renderDocument(this.app, decoded), 'text/html');
    this.hold(decoded);
    document.title = parsed.title;
    replaceBody(...Array.from(parsed.body.childNodes), parsed.body);
    this.htmx.process(document.body);
  }

  // Returns the htmx extension (HY-21, HY-23, HY-35).
  extension(): HyperExtension {
    const basePath = this.options.basePath;
    return {
      htmx_config_request: (_elt, { ctx }) => {
        if (!isRegion(ctx.target)) return;
        ctx.request.headers['Accept'] = 'application/json';
        ctx.request.headers['Hy-Region'] = ctx.target.id;
        ctx.hyperRegion = ctx.target.id;
        const action = ctx.request.action;
        if (basePath !== '' && action.startsWith('/') && !action.startsWith('//') && stripBasePath(pathOf(action), basePath) === null) {
          ctx.request.action = basePath + action;
        }
      },
      htmx_before_request: (_elt, { ctx }) => {
        if (ctx.hyperRegion === undefined) return;
        const requested = this.routeOf(ctx.request.action);
        const loading = requested === null ? Promise.resolve() : this.app.templates.ensure(routeTemplates(this.app.manifest, requested));
        ctx.fetch = async (url, init) => {
          const [response] = await Promise.all([fetch(url, init as RequestInit), loading]);
          const final = this.routeOf(response.url || url);
          if (final !== null && final !== requested) await this.app.templates.ensure(routeTemplates(this.app.manifest, final));
          return response;
        };
      },
      htmx_after_request: (_elt, { ctx }) => {
        if (ctx.hyperRegion === undefined || ctx.text === undefined) return;
        if (!(ctx.response?.headers.get('content-type') ?? '').startsWith('application/json')) return;
        const url = ctx.response?.raw?.url || ctx.request.action;
        const path = stripBasePath(pathOf(url), basePath);
        if (path === null) throw new Error(`hyper: response URL ${url} is outside the base path ${basePath}`);
        const decoded = decodeResponse(this.app, parseJson(ctx.text), path);
        ctx.text = toHtml(this.app, decoded);
        this.hold(decoded);
      },
      htmx_before_history_update: (_elt, { history }) => {
        if (basePath === '') return;
        const [path, query] = splitQuery(history.path);
        const stripped = stripBasePath(path, basePath);
        if (stripped !== null) history.path = stripped + query;
      },
      htmx_before_history_restore: (_elt, detail) => {
        if (basePath === '') return true;
        void this.renderLocation(detail.path);
        return false;
      },
    };
  }

  private async renderHeld(region: string): Promise<void> {
    const held = this.requireHeld();
    await this.app.templates.ensure(routeTemplates(this.app.manifest, held.route));
    const target = this.element(region);
    if (target === null) throw new Error(`hyper: region element #${region} does not exist`);
    const html = renderRegion(this.app, held.route, region, held.shared, held.regions, held.timezone);
    await this.htmx.swap({ text: html, target, swap: 'innerMorph', sourceElement: target });
  }

  private requireHeld(): Held {
    if (this.held === null) throw new Error('hyper: no response data is held');
    return this.held;
  }

  private routeOf(url: string): RouteDeclaration | null {
    const path = stripBasePath(pathOf(url), this.options.basePath);
    const match = path === null ? null : this.app.router.match(path);
    return match === null ? null : this.app.manifest.routes.find((item) => item.name === match.name)!;
  }
}

// Parses `path=value; path=value`, where a value is a JSON literal (HY-36).
export function parseAssignments(text: string): { path: string; value: unknown }[] {
  const assignments: { path: string; value: unknown }[] = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index <= text.length; index++) {
    const character = text[index];
    if (character === '"' && text[index - 1] !== '\\') quoted = !quoted;
    if (index === text.length || (character === ';' && !quoted)) {
      const part = text.slice(start, index).trim();
      start = index + 1;
      if (part === '') continue;
      const found = /^([A-Za-z_][A-Za-z0-9_]*(?:\.(?:[A-Za-z_][A-Za-z0-9_]*|\d+))*)\s*=\s*(.+)$/s.exec(part);
      if (found === null) throw new Error(`hyper: invalid hy-set assignment ${JSON.stringify(part)}`);
      assignments.push({ path: found[1]!, value: JSON.parse(found[2]!) });
    }
  }
  return assignments;
}

function child(container: Value | undefined, key: string, path: string): Value {
  if (container instanceof Map) {
    const value = container.get(key);
    if (value !== undefined) return value;
  } else if (Array.isArray(container) && /^\d+$/.test(key)) {
    const value = (container as ListValue)[Number(key)];
    if (value !== undefined) return value;
  }
  throw new Error(`hyper: ${path} does not exist in the region data`);
}

function assign(container: Value | undefined, key: string, value: Value, path: string): void {
  if (container instanceof Map) {
    container.set(key, value);
  } else if (Array.isArray(container) && /^\d+$/.test(key) && Number(key) < container.length) {
    (container as ListValue)[Number(key)] = value;
  } else {
    throw new Error(`hyper: ${path} cannot be set in the region data`);
  }
}

function replaceBody(...nodes: Node[]): void {
  const source = nodes.at(-1) instanceof HTMLBodyElement ? (nodes.pop() as HTMLBodyElement) : null;
  const body = document.createElement('body');
  for (const attribute of Array.from(source?.attributes ?? [])) body.setAttribute(attribute.name, attribute.value);
  body.append(...nodes);
  document.body.replaceWith(body);
}

function pathOf(url: string): string {
  return new URL(url, 'http://hyper.invalid').pathname;
}

function splitQuery(path: string): [string, string] {
  const index = path.search(/[?#]/);
  return index < 0 ? [path, ''] : [path.slice(0, index), path.slice(index)];
}

function isRegion(target: unknown): target is { id: string } {
  if (typeof target !== 'object' || target === null) return false;
  const element = target as { id?: unknown; hasAttribute?: (name: string) => boolean };
  return typeof element.hasAttribute === 'function' && element.hasAttribute('hy-region') && typeof element.id === 'string' && element.id !== '';
}
