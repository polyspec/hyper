// The steps of contracts/context.json (HY-124 to HY-128): the context hashes and the requests that an application with or
// without a context answers. Every expected value comes from the contract.
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { contextHash, heldContext } from '../../src/context.js';
import { maskedToken } from '../../src/csrf.js';
import { decodeJson, encodeJson } from '../../src/json.js';
import { App, MemorySessionStore, NotFound, Request, Result, type Handlers, type RouteHandlers } from '../../src/index.js';
import type { Value } from '../../src/values.js';
import type { CaseReader } from '../case-reader.js';
import { parsed, record } from '../support.js';

interface Application {
  manifest: { routes: { name: string; regions?: { name: string }[]; post?: boolean }[] } & Record<string, unknown>;
  build: string;
  context?: string;
  shared: Record<string, unknown>;
  loaders: Record<string, Record<string, unknown>>;
  embedData: string[];
  actions: Record<string, { page?: number; data?: Record<string, unknown>; redirect?: string }>;
}

// The applications of the contracts, built once for the three servers by scripts/contract-programs.mjs (HY-124, HYC-24).
const PROGRAMS = fileURLToPath(new URL('../../../../../var/contract-programs/', import.meta.url));
const JSON_TYPE = 'application/vnd.hyper+json';

// Converts the Maps of a parsed contract value into plain objects, the shape the application handlers read.
function plain(value: unknown): unknown {
  if (value instanceof Map) return Object.fromEntries([...value].map(([key, item]) => [key, plain(item)]));
  if (Array.isArray(value)) return value.map(plain);
  return value;
}

// Returns the handlers of an application for one case: each route loads its stated data, stops with NotFound when the
// contract says so, and embeds its data when the contract lists it; each action returns its stated page or redirect;
// the shared handler returns the shared data of the case. Every call is recorded in order (HY-124).
function handlersOf(application: Application, shared: Record<string, unknown>, calls: string[]): Handlers<Record<string, never>> {
  const routes: Record<string, RouteHandlers<Record<string, never>>> = {};
  for (const route of application.manifest.routes) {
    const spec = application.loaders[route.name] ?? {};
    const embeds = application.embedData.includes(route.name);
    const regions: Record<string, () => Map<string, Value>> = {};
    for (const region of route.regions ?? []) {
      const regionSpec = application.loaders[region.name] ?? {};
      regions[region.name] = () => new Map(Object.entries(regionSpec) as [string, Value][]);
    }
    const handler: RouteHandlers<Record<string, never>> = {
      load: ({ reply }) => {
        if (embeds) reply.embedData();
        if (spec.stop === 'NotFound') throw new NotFound();
        return new Map(Object.entries(spec) as [string, Value][]);
      },
      regions,
    };
    if (route.post === true) {
      handler.post = () => {
        calls.push(`action:${route.name}`);
        const action = application.actions[route.name];
        if (action === undefined) throw new Error(`the contract has no action for ${route.name}`);
        if (action.redirect !== undefined) return Result.redirect(action.redirect);
        return Result.page(action.page ?? 200, action.data ?? {});
      };
    }
    routes[route.name] = handler;
  }
  return {
    shared: () => {
      calls.push('shared');
      return new Map(Object.entries(shared) as [string, Value][]);
    },
    routes,
  };
}

// Returns the form body of a case: its fields, with `_csrf` when the case sends a token (HY-24).
function bodyOf(form: Map<string, string> | undefined, csrf: boolean, token: string | null): string | undefined {
  const fields: Record<string, string> = { ...(form === undefined ? {} : Object.fromEntries(form)) };
  if (csrf) fields._csrf = token ?? '';
  return form === undefined && !csrf ? undefined : new URLSearchParams(fields).toString();
}

export const steps = {
  contexts(reader: CaseReader): void {
    const build = reader.input('build') as string;
    const context = reader.input('context') as string;
    const text = encodeJson(decodeJson(context) as Map<string, Value>);
    reader.compare('context', text);
    reader.compare('text', `{"build":"${build}","context":${text}}`);
    reader.compare('hash', contextHash(build, text));
    if (reader.has('reorderedText')) {
      const reordered = decodeJson(reader.input('reorderedText') as string) as Map<string, Value>;
      reader.compare('reorderedHash', contextHash(build, encodeJson(reordered.get('context') as Map<string, Value>)));
    }
  },

  async cases(reader: CaseReader): Promise<void> {
    const name = reader.input('application') as string;
    const applications = reader.input('applications') as Map<string, unknown>;
    const application = plain(applications.get(name)) as Application | undefined;
    if (application === undefined) throw new Error(`the contract has no application ${name}`);
    const dir = join(PROGRAMS, name);
    const shared = reader.has('shared') ? (plain(reader.input('shared')) as Record<string, unknown>) : application.shared;
    const calls: string[] = [];
    const selections: unknown[] = [];
    const handlers = handlersOf(application, shared, calls);
    const app = await App.open<Record<string, never>>({
      manifest: join(dir, 'manifest.json'),
      build: join(dir, 'build.json'),
      templates: { index: join(dir, 'node', 'templates.index.json'), root: join(dir, 'node') },
      handlers,
      timezone: '+09:00',
      log: () => {},
      ...(application.context === undefined
        ? {}
        : {
            context: (selection: unknown) => {
              calls.push('context');
              selections.push(selection);
              return heldContext(() => decodeJson(application.context ?? '') as Map<string, Value>, selection);
            },
          }),
    });
    const store = new MemorySessionStore();
    const csrf = reader.has('request.csrf') && reader.input('request.csrf') === true;
    let token: string | null = null;
    if (csrf) {
      // A first response of the same session makes its token (HY-24); the case masks the token that the session holds.
      // Its calls are not the case's calls.
      await app.handle(Request.from({ method: 'GET', target: '/', headers: { Accept: JSON_TYPE } }), store);
      token = maskedToken(String(store.get('_hyper_csrf')));
      calls.length = 0;
      selections.length = 0;
    }
    const form = reader.has('request.form') ? (reader.input('request.form') as Map<string, string>) : undefined;
    const body = bodyOf(form, csrf, token);
    const headers = Object.fromEntries(reader.input('request.headers') as Map<string, string>);
    const requestHeaders = body === undefined ? headers : { 'Content-Type': 'application/x-www-form-urlencoded', ...headers };
    const response = await app.handle(
      Request.from({
        method: reader.input('request.method') as string,
        target: reader.input('request.target') as string,
        headers: requestHeaders,
        body: body === undefined ? undefined : Buffer.from(body, 'latin1'),
      }),
      store,
    );

    reader.compare('status', response.status);
    reader.compare('headers', response.headers);
    reader.compare('absentHeaders', response.headers);
    reader.compare('body', response.body);
    reader.compare('bodyContains', response.body);
    reader.compare('bodyNotContains', response.body);
    if (reader.has('keys') || reader.has('sharedKeys')) {
      const json = record(parsed(response.body));
      reader.compare('keys', json);
      reader.compare('sharedKeys', record(json.shared));
    }
    reader.compare('contextCalls', calls.filter((call) => call === 'context').length);
    reader.compare('firstCalls', calls);
    reader.compare('selection', selections);
  },
};
