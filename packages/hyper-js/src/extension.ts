import { parseJson } from '@polyspec/template/render';
import { toHtml, type Application } from './response.js';
import { stripBasePath } from './router.js';

// The part of an htmx 4 request context that the extension reads and writes.
export interface RequestContext {
  target?: unknown;
  request: { action: string; headers: Record<string, string> };
  response?: { raw?: { url: string }; headers: { get(name: string): string | null } };
  text?: string;
  hyperRegion?: string;
}

export interface HookDetail {
  ctx: RequestContext;
}

export interface HistoryDetail {
  history: { type: string; path: string };
}

export interface RestoreDetail {
  path: string;
}

export interface ExtensionOptions {
  // The base path of the server for client-side rendering; empty for server-side rendering (HY-23).
  basePath: string;
  // Renders a restored history path; given only for client-side rendering (HY-23).
  restore?: (path: string) => void;
}

export interface HyperExtension {
  htmx_config_request(elt: unknown, detail: HookDetail): void;
  htmx_after_request(elt: unknown, detail: HookDetail): void;
  htmx_before_history_update(elt: unknown, detail: HistoryDetail): void;
  htmx_before_history_restore(elt: unknown, detail: RestoreDetail): boolean;
}

interface RegionElement {
  id: string;
  hasAttribute(name: string): boolean;
}

// Returns the htmx extension that requests JSON for regions and renders it (HY-21, HY-23).
export function hyperExtension(app: Application, options: ExtensionOptions): HyperExtension {
  const { basePath } = options;
  return {
    htmx_config_request(_elt, { ctx }) {
      if (!isRegion(ctx.target)) return;
      ctx.request.headers['Accept'] = 'application/json';
      ctx.request.headers['Hy-Region'] = ctx.target.id;
      ctx.hyperRegion = ctx.target.id;
      const action = ctx.request.action;
      if (basePath !== '' && action.startsWith('/') && !action.startsWith('//') && stripBasePath(pathOf(action), basePath) === null) {
        ctx.request.action = basePath + action;
      }
    },
    htmx_after_request(_elt, { ctx }) {
      if (ctx.hyperRegion === undefined || ctx.text === undefined) return;
      const type = ctx.response?.headers.get('content-type') ?? '';
      if (!type.startsWith('application/json')) return;
      const url = ctx.response?.raw?.url || ctx.request.action;
      const path = stripBasePath(pathOf(url), basePath);
      if (path === null) throw new Error(`hyper: response URL ${url} is outside the base path ${basePath}`);
      ctx.text = toHtml(app, parseJson(ctx.text), path);
    },
    htmx_before_history_update(_elt, { history }) {
      if (basePath === '') return;
      const [path, query] = splitQuery(history.path);
      const stripped = stripBasePath(path, basePath);
      if (stripped !== null) history.path = stripped + query;
    },
    htmx_before_history_restore(_elt, detail) {
      if (options.restore === undefined) return true;
      options.restore(detail.path);
      return false;
    },
  };
}

// Returns the path of an absolute URL or of a path with an optional query string.
function pathOf(url: string): string {
  return new URL(url, 'http://hyper.invalid').pathname;
}

function splitQuery(path: string): [string, string] {
  const index = path.search(/[?#]/);
  return index < 0 ? [path, ''] : [path.slice(0, index), path.slice(index)];
}

function isRegion(target: unknown): target is RegionElement {
  if (typeof target !== 'object' || target === null) return false;
  const element = target as Partial<RegionElement>;
  return typeof element.hasAttribute === 'function' && element.hasAttribute('hy-region') && typeof element.id === 'string' && element.id !== '';
}
