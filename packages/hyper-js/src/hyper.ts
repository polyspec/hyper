import { bind, parseJson, type ListValue, type MapValue, type Value } from '@polyspec/template/render';
import { applyRegionKept, copyValue, decodeResponse, renderDocument, renderRegion, requireMap, toHtml, type Application, type DecodedResponse } from './response.js';
import { stripBasePath } from './router.js';
import { routeTemplates } from './templates.js';
import { keptPaths, type RouteDeclaration } from './manifest.js';
import { browserStorage, valueToJson, type KeepStorage } from './keep.js';

// The htmx operations that the browser code uses.
export interface HtmxApi {
  process(element: Element): void;
  swap(ctx: { text: string; target: Element; swap: string; sourceElement: Element }): Promise<unknown>;
  config: { defaultTimeout: number };
  parseInterval(value: string): number;
}

// The part of an htmx 4 request context that the extension reads and writes.
export interface RequestContext {
  target?: unknown;
  request: { action: string; method?: string; headers: Record<string, string>; abort?: () => void; timeout?: string | number | null };
  response?: { raw?: { url: string }; status?: number; headers: { get(name: string): string | null } };
  text?: string;
  fetch?: (url: string, init: unknown) => Promise<Response>;
  hyperRegion?: string;
  // when the region request was configured and when it was aborted (HY-47)
  hyperStart?: number;
  hyperAborted?: number;
}

export interface HookDetail {
  ctx: RequestContext;
}

export interface HyperExtension {
  htmx_config_request(elt: unknown, detail: HookDetail): void;
  htmx_before_request(elt: unknown, detail: HookDetail): void;
  htmx_after_request(elt: unknown, detail: HookDetail): boolean | void;
  htmx_after_swap(elt: unknown, detail: HookDetail): void;
  htmx_error(elt: unknown, detail: { ctx?: RequestContext; error?: unknown }): void;
  htmx_before_history_update(elt: unknown, detail: { history: { type: string; path: string } }): void;
  htmx_before_history_restore(elt: unknown, detail: { path: string }): boolean;
}

// Mounts documents that client-side rendering produces.
export interface DocumentAdapter {
  // Replaces the title and the body with those of a rendered document and lets htmx process the body.
  mount(html: string): void;
  // Replaces the body with text, for a path without a route or a response that is not JSON.
  text(text: string): void;
  // Marks the body as failed when a document cannot be rendered (HY-47).
  fail(status: string): void;
}

// The data of the last rendered response (HY-32): the loader data and the region data that rendered.
interface Held {
  route: RouteDeclaration;
  timezone: string;
  shared: MapValue;
  loader: MapValue;
  regions: MapValue;
}

interface RegionElement {
  id: string;
  setAttribute?(name: string, value: string): void;
  removeAttribute?(name: string): void;
}

export interface HyperOptions {
  // The base path of the server for client-side rendering; empty for server-side rendering (HY-22, HY-23).
  basePath: string;
  // Returns the element with an id; the default reads the document.
  element?: (id: string) => Element | null;
  // Performs requests for client-side rendering; the default is the global fetch.
  fetch?: typeof fetch;
  // Stores kept values (HY-37); the default uses the browser document.
  storage?: KeepStorage;
  // Mounts client-side rendered documents; the default uses the browser document.
  document?: DocumentAdapter;
  // Returns the URL of the current page; the default reads the browser location.
  currentUrl?: () => string;
}

// A server kept value whose saving has not completed, with the number of its change and the number of
// the change whose save is in flight (HY-39).
interface Pending {
  value: Value;
  change: number;
  sending: number | null;
}

// Holds region data and renders regions from it (HY-29 to HY-39, HY-47).
export class Hyper {
  private held: Held | null = null;
  private browserStorage: KeepStorage | null = null;
  // server kept values whose saving has not completed, by region and path (HY-38, HY-39)
  private readonly pending = new Map<string, Map<string, Pending>>();
  private changes = 0;
  // the end of the last queued render, set or hy-set call (HY-33)
  private queue: Promise<void> = Promise.resolve();
  private location = 0;
  private locationAbort: AbortController | null = null;
  private readonly element: (id: string) => Element | null;
  private readonly request: typeof fetch;
  private readonly page: DocumentAdapter;
  private readonly currentUrl: () => string;

  constructor(readonly app: Application, private readonly htmx: HtmxApi, private readonly options: HyperOptions) {
    this.element = options.element ?? ((id) => document.getElementById(id));
    this.request = options.fetch ?? ((input, init) => fetch(input, init));
    this.page = options.document ?? browserDocument(htmx);
    this.currentUrl = options.currentUrl ?? (() => window.location.href);
  }

  // Holds the data of a rendered response. A replacing hold drops every region of the earlier
  // response; otherwise only the regions of the earlier route are replaced (HY-32).
  hold(decoded: DecodedResponse, replace = false): void {
    const loader: MapValue = new Map();
    const regions: MapValue = new Map();
    if (this.held !== null && !replace) {
      const dropped = new Set([this.app.page, ...(this.held.route.regions ?? []).map((region) => region.name)]);
      for (const [name, data] of this.held.regions) if (!dropped.has(name)) regions.set(name, data);
      for (const [name, data] of this.held.loader) if (!dropped.has(name)) loader.set(name, data);
    }
    for (const [name, data] of decoded.regions) regions.set(name, data);
    for (const [name, data] of decoded.loader) loader.set(name, data);
    this.held = { route: decoded.route, timezone: decoded.timezone, shared: decoded.shared, loader, regions };
  }

  // Holds the data that the server embedded in the document, replacing all held data, starts loading
  // the templates of its route, and renders regions that browser kept values change. A region that does
  // not render with its kept values renders with its loader data. A failure marks the region, or the body
  // when the embedded data cannot be read, and does not reject (HY-31, HY-32, HY-38, HY-47).
  async holdEmbedded(text: string, path: string): Promise<void> {
    let decoded: DecodedResponse;
    try {
      decoded = decodeResponse(this.app, parseJson(text), path);
    } catch {
      this.page.fail('0');
      return;
    }
    const changed = this.applyBrowserKept(decoded);
    this.hold(decoded, true);
    const held = this.held!;
    try {
      await this.app.templates.ensure(routeTemplates(this.app.manifest, decoded.route));
    } catch {
      if (this.held === held) for (const region of changed) markError(this.element(region), '0');
      return;
    }
    for (const region of changed) {
      if (this.held !== held) return;
      try {
        await this.renderHeld(region);
      } catch {
        if (this.held !== held) return;
        held.regions.set(region, copyValue(held.loader.get(region) ?? null));
        try {
          await this.renderHeld(region);
        } catch {
          if (this.held === held) markError(this.element(region), '0');
        }
      }
    }
  }

  // Returns the held data of a region (HY-33).
  data(region: string): Value | undefined {
    return this.held?.regions.get(region);
  }

  // Replaces the held data of a region and renders the region (HY-33).
  async render(region: string, data: unknown): Promise<void> {
    await this.change(region, () => requireMap(bind(data), `data of region ${region}`), Object.keys(keptPaths(this.app.manifest, region)));
  }

  // Sets one value in the held data of a region by a dotted path and renders the region (HY-33).
  async set(region: string, path: string, value: unknown): Promise<void> {
    await this.change(region, (data) => {
      assignPath(data, path, bind(value));
      return requireMap(data ?? null, `data of region ${region}`);
    }, [path]);
  }

  // Runs the assignments of a `hy-set` attribute in the region that contains the element (HY-36).
  async setFrom(element: Element): Promise<void> {
    const held = this.requireHeld();
    const names = [...this.app.manifest.regions.map((item) => item.name), ...(held.route.regions ?? []).map((item) => item.name)];
    // A region element is the element whose id is a region name (HY-3, HY-36).
    const region = element.closest(names.map((name) => `[id="${name}"]`).join(','))?.id;
    if (region === undefined || region === '') throw new Error('hyper: hy-set is outside a region');
    const assignments = parseAssignments(element.getAttribute('hy-set') ?? '');
    await this.change(region, (data) => {
      for (const { path, value } of assignments) assignPath(data, path, bind(value));
      return requireMap(data ?? null, `data of region ${region}`);
    }, assignments.map((assignment) => assignment.path));
  }

  // Queues a change; calls run one after another in call order (HY-33).
  private change(region: string, update: (data: Value | undefined) => MapValue, paths: readonly string[]): Promise<void> {
    const run = this.queue.then(() => this.applyChange(region, update, paths));
    this.queue = run.catch(() => undefined);
    return run;
  }

  // Changes a copy of the held data of a region, renders the region with it, and only then holds it
  // and stores the changed kept paths. The change ends without swapping, holding or storing when a
  // response replaced the data of its region before the swap; when that happened during the swap, the
  // region renders again from held data. A failure leaves held data unchanged and marks the region (HY-33, HY-47).
  private async applyChange(region: string, update: (data: Value | undefined) => MapValue, paths: readonly string[]): Promise<void> {
    const before = this.requireHeld().regions.get(region);
    const replaced = (): boolean => this.requireHeld().regions.get(region) !== before;
    let next: MapValue;
    try {
      next = update(before === undefined ? undefined : copyValue(before));
      await this.app.templates.ensure(routeTemplates(this.app.manifest, this.requireHeld().route));
      if (replaced()) return;
      const held = this.requireHeld();
      const target = this.element(region);
      if (target === null) throw new Error(`hyper: region element #${region} does not exist`);
      const regions: MapValue = new Map(held.regions);
      regions.set(region, next);
      const html = renderRegion(this.app, held.route, region, held.shared, regions, held.timezone);
      await this.htmx.swap({ text: html, target, swap: 'innerMorph', sourceElement: target });
      if (replaced()) {
        if (this.requireHeld().regions.has(region)) await this.renderHeld(region);
        return;
      }
      clearError(target);
      this.requireHeld().regions.set(region, next);
    } catch (error) {
      if (!replaced()) markError(this.element(region), '0');
      throw error;
    }
    this.store(region, paths, next);
  }

  // Renders the document of a path in the browser. A later call cancels an earlier one that is
  // still loading, and only the latest is mounted (HY-22, HY-23, HY-35).
  async renderLocation(location: string): Promise<void> {
    const generation = ++this.location;
    this.locationAbort?.abort();
    const abort = new AbortController();
    this.locationAbort = abort;
    const url = new URL(location, 'http://hyper.invalid');
    const match = this.app.router.match(url.pathname);
    if (match === null) {
      this.page.text('Not Found');
      return;
    }
    const route = this.app.manifest.routes.find((item) => item.name === match.name)!;
    try {
      const [response] = await Promise.all([
        this.request(this.options.basePath + url.pathname + url.search, { headers: { Accept: 'application/json' }, credentials: 'same-origin', signal: abort.signal }),
        this.app.templates.ensure(routeTemplates(this.app.manifest, route)),
      ]);
      const text = await response.text();
      if (generation !== this.location) return;
      if (!(response.headers.get('content-type') ?? '').startsWith('application/json')) {
        this.page.text(text);
        return;
      }
      // The document belongs to the URL after redirects (HY-20, HY-22).
      const path = response.url ? stripBasePath(pathOf(response.url), this.options.basePath) : url.pathname;
      if (path === null) throw new Error(`hyper: response URL ${response.url} is outside the base path ${this.options.basePath}`);
      const final = this.routeOf(this.options.basePath + path);
      if (final !== null && final !== route) await this.app.templates.ensure(routeTemplates(this.app.manifest, final));
      if (generation !== this.location) return;
      const decoded = decodeResponse(this.app, parseJson(text), path);
      this.applyBrowserKept(decoded);
      const html = renderDocument(this.app, decoded);
      this.hold(decoded, true);
      this.page.mount(html);
    } catch {
      if (abort.signal.aborted || generation !== this.location) return;
      this.page.fail('0');
    }
  }

  // Returns the htmx extension (HY-21, HY-23, HY-32, HY-35, HY-47).
  extension(): HyperExtension {
    const basePath = this.options.basePath;
    return {
      htmx_config_request: (_elt, { ctx }) => {
        // Only a request whose target is the page region element is a region request; htmx sends HX-Request (HY-15, HY-21).
        if (!isElementWithId(ctx.target) || ctx.target.id !== this.app.page) return;
        ctx.request.headers['Accept'] = 'application/json';
        ctx.hyperRegion = ctx.target.id;
        ctx.hyperStart = performance.now();
        if (basePath !== '') {
          const page = new URL(this.currentUrl());
          const url = new URL(ctx.request.action, page);
          if (url.origin === page.origin) ctx.request.action = basePath + url.pathname + url.search;
        }
      },
      htmx_before_request: (_elt, { ctx }) => {
        if (ctx.hyperRegion === undefined) return;
        // A region request is the latest navigation; a client-side restoration still loading is cancelled (HY-23).
        this.location++;
        this.locationAbort?.abort();
        // htmx aborts through this function on its timeout and on cancellation; the time tells them apart (HY-47).
        const abort = ctx.request.abort;
        ctx.request.abort = () => {
          ctx.hyperAborted ??= performance.now();
          abort?.();
        };
        const requested = this.routeOf(ctx.request.action);
        const loading = requested === null ? Promise.resolve() : this.app.templates.ensure(routeTemplates(this.app.manifest, requested));
        loading.catch(() => undefined);
        ctx.fetch = async (url, init) => {
          const [response] = await Promise.all([fetch(url, init as RequestInit), loading]);
          const final = this.routeOf(response.url || url);
          if (final !== null && final !== requested) await this.app.templates.ensure(routeTemplates(this.app.manifest, final));
          return response;
        };
      },
      htmx_after_request: (_elt, { ctx }) => {
        if (ctx.hyperRegion === undefined || ctx.text === undefined) return;
        if (!(ctx.response?.headers.get('content-type') ?? '').startsWith('application/json')) {
          markError(ctx.target, String(ctx.response?.status ?? 0));
          return false;
        }
        const url = ctx.response?.raw?.url || ctx.request.action;
        const path = stripBasePath(pathOf(url), basePath);
        if (path === null) throw new Error(`hyper: response URL ${url} is outside the base path ${basePath}`);
        const decoded = decodeResponse(this.app, parseJson(ctx.text), path);
        this.applyBrowserKept(decoded);
        ctx.text = toHtml(this.app, decoded);
        this.hold(decoded);
        clearError(ctx.target);
        for (const name of decoded.regions.keys()) clearError(this.element(name));
      },
      htmx_after_swap: (_elt, { ctx }) => {
        // Swaps of render and set have no request.
        if (basePath !== '' || ctx.request?.headers?.['HX-History-Restore-Request'] !== 'true') return;
        const embedded = this.element('hy-data')?.textContent;
        if (embedded) void this.holdEmbedded(embedded, pathOf(ctx.request.action));
      },
      htmx_error: (_elt, detail) => {
        const ctx = detail.ctx;
        if (ctx?.hyperRegion === undefined) return;
        if (detail.error instanceof Error && detail.error.name === 'AbortError' && !this.timedOut(ctx)) return;
        markError(ctx.target, '0');
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

  // Returns true when htmx aborted a region request after its timeout passed (HY-47).
  private timedOut(ctx: RequestContext): boolean {
    const timeout = ctx.request.timeout != null ? this.htmx.parseInterval(String(ctx.request.timeout)) : this.htmx.config.defaultTimeout;
    return timeout > 0 && ctx.hyperStart !== undefined && ctx.hyperAborted !== undefined && ctx.hyperAborted - ctx.hyperStart >= timeout;
  }

  // Applies localStorage, sessionStorage and pending server values to the region data of a response,
  // after its server kept values, and returns the regions that changed (HY-38).
  private applyBrowserKept(decoded: DecodedResponse): string[] {
    const changed: string[] = [];
    for (const name of decoded.regions.keys()) {
      // localStorage and sessionStorage values first, then pending server values, whatever the declaration order (HY-38).
      const stored: [string, Value][] = [];
      const pending: [string, Value][] = [];
      for (const [path, kind] of Object.entries(keptPaths(this.app.manifest, name))) {
        if (kind === 'server') {
          const value = this.pending.get(name)?.get(path);
          if (value !== undefined) pending.push([path, value.value]);
          continue;
        }
        if (kind !== 'localStorage' && kind !== 'sessionStorage') continue;
        const text = this.storage().read(kind, name, path);
        if (text === null) continue;
        try {
          stored.push([path, parseJson(text)]);
        } catch {
          continue;
        }
      }
      const applied = [...applyRegionKept(decoded, name, stored), ...applyRegionKept(decoded, name, pending)];
      if (applied.length > 0) changed.push(name);
    }
    return changed;
  }

  // Stores every kept path that equals a changed path, lies under it or contains it, with the value in
  // the committed region data (HY-39).
  private store(region: string, changed: readonly string[], data: MapValue): void {
    for (const [path, kind] of Object.entries(keptPaths(this.app.manifest, region))) {
      if (!changed.some((item) => item === path || path.startsWith(`${item}.`) || item.startsWith(`${path}.`))) continue;
      const value = valueAt(data, path);
      if (value === undefined) continue;
      if (kind !== 'server') {
        this.storage().write(kind, region, path, valueToJson(value));
        continue;
      }
      const values = this.pending.get(region) ?? new Map<string, Pending>();
      const sending = values.get(path)?.sending ?? null;
      values.set(path, { value, change: ++this.changes, sending });
      this.pending.set(region, values);
      if (sending === null) this.save(region, path);
    }
  }

  // Sends the pending value of a server path. When the save settles and a later change exists, the latest
  // value is sent next; otherwise a success clears the pending value and a failure marks the region (HY-39).
  private save(region: string, path: string): void {
    const pending = this.pending.get(region)!.get(path)!;
    const change = pending.change;
    pending.sending = change;
    const csrf = this.held?.shared.get('csrf');
    void this.storage()
      .send(`${this.options.basePath}/_hyper/keep`, { _csrf: typeof csrf === 'string' ? csrf : '', region, path, value: valueToJson(pending.value) })
      .then((saved) => {
        const current = this.pending.get(region)?.get(path);
        if (current === undefined) return;
        current.sending = null;
        if (current.change !== change) this.save(region, path);
        else if (saved) this.pending.get(region)!.delete(path);
        else markError(this.element(region), '0');
      });
  }

  private storage(): KeepStorage {
    return this.options.storage ?? (this.browserStorage ??= browserStorage());
  }

  private async renderHeld(region: string): Promise<void> {
    const held = this.requireHeld();
    await this.app.templates.ensure(routeTemplates(this.app.manifest, held.route));
    const target = this.element(region);
    if (target === null) throw new Error(`hyper: region element #${region} does not exist`);
    const html = renderRegion(this.app, held.route, region, held.shared, held.regions, held.timezone);
    await this.htmx.swap({ text: html, target, swap: 'innerMorph', sourceElement: target });
    clearError(target);
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
    if (quoted && character === '\\') {
      index++;
      continue;
    }
    if (character === '"') quoted = !quoted;
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

// Replaces the value at an existing path; a missing map key or list index fails (HY-33).
function assignPath(data: Value | undefined, path: string, value: Value): void {
  const keys = path.split('.');
  let container = data;
  for (const key of keys.slice(0, -1)) {
    container = childOf(container, key);
    if (container === undefined) throw new Error(`hyper: ${path} does not exist in the region data`);
  }
  const last = keys[keys.length - 1]!;
  if (childOf(container, last) === undefined) throw new Error(`hyper: ${path} does not exist in the region data`);
  if (container instanceof Map) container.set(last, value);
  else (container as ListValue)[Number(last)] = value;
}

function valueAt(data: Value | undefined, path: string): Value | undefined {
  let value = data;
  for (const key of path.split('.')) value = childOf(value, key);
  return value;
}

function childOf(container: Value | undefined, key: string): Value | undefined {
  if (container instanceof Map) return container.get(key);
  if (Array.isArray(container) && /^\d+$/.test(key)) return (container as ListValue)[Number(key)];
  return undefined;
}

// Marks a region element as failed with a status, or clears the mark (HY-47).
function markError(target: unknown, status: string): void {
  const element = target as RegionElement | null;
  if (element !== null && typeof element === 'object' && typeof element.setAttribute === 'function') element.setAttribute('hy-error', status);
}

function clearError(target: unknown): void {
  const element = target as RegionElement | null;
  if (element !== null && typeof element === 'object' && typeof element.removeAttribute === 'function') element.removeAttribute('hy-error');
}

// The document adapter of a browser page.
function browserDocument(htmx: HtmxApi): DocumentAdapter {
  const replaceBody = (source: HTMLElement | null, nodes: Node[]): void => {
    const body = document.createElement('body');
    for (const attribute of Array.from(source?.attributes ?? [])) body.setAttribute(attribute.name, attribute.value);
    body.append(...nodes);
    document.body.replaceWith(body);
  };
  return {
    mount: (html) => {
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      document.title = parsed.title;
      replaceBody(parsed.body, Array.from(parsed.body.childNodes));
      htmx.process(document.body);
    },
    text: (text) => replaceBody(null, [document.createTextNode(text)]),
    fail: (status) => document.body.setAttribute('hy-error', status),
  };
}

function pathOf(url: string): string {
  return new URL(url, 'http://hyper.invalid').pathname;
}

function splitQuery(path: string): [string, string] {
  const index = path.search(/[?#]/);
  return index < 0 ? [path, ''] : [path.slice(0, index), path.slice(index)];
}

function isElementWithId(target: unknown): target is RegionElement {
  return typeof target === 'object' && target !== null && typeof (target as Partial<RegionElement>).id === 'string';
}
