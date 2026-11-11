// The cases of contracts/context.json (HY-124 to HY-128): the context hashes and the requests that an application with
// or without a context answers. The file is read as it is; every expected value comes from it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contextHash, heldContext, withContext } from '../src/context.js';
import { maskedToken } from '../src/csrf.js';
import { decodeJson, encodeJson } from '../src/json.js';
import { App, MemorySessionStore, NotFound, Request, Result, type Handlers, type RouteHandlers } from '../src/index.js';
import type { Value } from '../src/values.js';

interface Application {
  manifest: { routes: { name: string; regions?: { name: string }[]; post?: boolean }[] } & Record<string, unknown>;
  templates: Record<string, string>;
  build: string;
  context?: string;
  shared: Record<string, unknown>;
  loaders: Record<string, Record<string, unknown>>;
  embedData: string[];
  actions: Record<string, { page?: number; data?: Record<string, unknown>; redirect?: string }>;
}

interface Case {
  id: string;
  application: string;
  shared?: Record<string, unknown>;
  request: { method: string; target: string; headers: Record<string, string>; form?: Record<string, string>; csrf?: boolean };
  status: number;
  headers?: Record<string, string>;
  absentHeaders?: string[];
  body?: string;
  bodyContains?: string[];
  bodyNotContains?: string[];
  keys?: string[];
  sharedKeys?: string[];
  contextCalls?: number;
  firstCalls?: string[];
  selection?: unknown[];
}

const contract = JSON.parse(readFileSync(new URL('../../../../contracts/context.json', import.meta.url), 'utf8')) as {
  contexts: { id: string; build: string; context: string; text: string; hash: string }[];
  applications: Record<string, Application>;
  cases: Case[];
};
// The applications of the contracts, built once for the three servers by scripts/contract-programs.mjs (HY-124, HYC-24).
const PROGRAMS = fileURLToPath(new URL('../../../../var/contract-programs/', import.meta.url));
const JSON_TYPE = 'application/vnd.hyper+json';

const prepared = new Map<string, { manifest: string; build: string; index: string; root: string }>();

// Returns the application of the contract with the given name, or fails when the contract has none.
function applicationOf(name: string): Application {
  const application = contract.applications[name];
  if (application === undefined) throw new Error(`the contract has no application ${name}`);
  return application;
}

// Returns the paths of an application built by scripts/contract-programs.mjs: its manifest, its build id file and the
// template index and root that the Node server opens (HR-34). Each application is looked up once per run.
function prepare(name: string): { manifest: string; build: string; index: string; root: string } {
  const existing = prepared.get(name);
  if (existing !== undefined) return existing;
  applicationOf(name);
  const dir = join(PROGRAMS, name);
  const entry = { manifest: join(dir, 'manifest.json'), build: join(dir, 'build.json'), index: join(dir, 'node', 'templates.index.json'), root: join(dir, 'node') };
  prepared.set(name, entry);
  return entry;
}

// Returns the handlers of an application for one case: each route loads its stated data, stops with NotFound when the
// contract says so, and embeds its data when the contract lists it; each action returns its stated page or redirect;
// the shared handler returns the shared data of the case. Every call is recorded in order (HY-124).
function handlersOf(name: string, shared: Record<string, unknown>, calls: string[]): Handlers<Record<string, never>> {
  const application = applicationOf(name);
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
function bodyOf(item: Case, token: string | null): string | undefined {
  const fields = { ...item.request.form };
  if (item.request.csrf === true) fields._csrf = token ?? '';
  return item.request.form === undefined && item.request.csrf !== true ? undefined : new URLSearchParams(fields).toString();
}

describe('context hashes (HY-125)', () => {
  for (const entry of contract.contexts) {
    it(`computes the JSON text and the hash of ${entry.id}`, () => {
      const text = encodeJson(decodeJson(entry.context) as Map<string, Value>);
      expect(text).toBe(entry.context);
      expect(`{"build":"${entry.build}","context":${text}}`).toBe(entry.text);
      expect(contextHash(entry.build, text)).toBe(entry.hash);
    });
  }
});

describe('context requests (HY-124 to HY-128)', () => {
  for (const item of contract.cases) {
    it(item.id, async () => {
      const application = applicationOf(item.application);
      const location = prepare(item.application);
      const calls: string[] = [];
      const selections: unknown[] = [];
      const shared = item.shared ?? application.shared;
      const handlers = handlersOf(item.application, shared, calls);
      const app = await App.open<Record<string, never>>({
        manifest: location.manifest,
        build: location.build,
        templates: { index: location.index, root: location.root },
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
      let token: string | null = null;
      if (item.request.csrf === true) {
        // A first response of the same session makes its token (HY-24); the case masks the token that the session holds.
        // Its calls are not the case's calls.
        await app.handle(Request.from({ method: 'GET', target: '/', headers: { Accept: JSON_TYPE } }), store);
        token = maskedToken(String(store.get('_hyper_csrf')));
        calls.length = 0;
        selections.length = 0;
      }
      const body = bodyOf(item, token);
      const headers = body === undefined ? item.request.headers : { 'Content-Type': 'application/x-www-form-urlencoded', ...item.request.headers };
      const response = await app.handle(
        Request.from({ method: item.request.method, target: item.request.target, headers, body: body === undefined ? undefined : Buffer.from(body, 'latin1') }),
        store,
      );

      expect(response.status).toBe(item.status);
      for (const [name, value] of Object.entries(item.headers ?? {})) expect(response.headers[name], name).toBe(value);
      for (const name of item.absentHeaders ?? []) expect(response.headers[name], name).toBeUndefined();
      if (item.body !== undefined) expect(response.body).toBe(item.body);
      for (const text of item.bodyContains ?? []) expect(response.body).toContain(text);
      for (const text of item.bodyNotContains ?? []) expect(response.body).not.toContain(text);
      if (item.keys !== undefined || item.sharedKeys !== undefined) {
        const json = JSON.parse(response.body) as { shared: Record<string, unknown> };
        if (item.keys !== undefined) expect(Object.keys(json)).toEqual(item.keys);
        if (item.sharedKeys !== undefined) expect(Object.keys(json.shared)).toEqual(item.sharedKeys);
      }
      if (item.contextCalls !== undefined) expect(calls.filter((call) => call === 'context')).toHaveLength(item.contextCalls);
      // firstCalls are the first calls of the request in order, so the calls that the case states are its prefix.
      if (item.firstCalls !== undefined) expect(calls.slice(0, item.firstCalls.length)).toEqual(item.firstCalls);
      item.selection?.forEach((expected, i) => {
        if (i < selections.length) expect(selections[i]).toBe(expected);
      });
    });
  }
});

describe('the order of the shared data (HY-10, HY-73)', () => {
  const held = new Map<string, Value>([['name', 'Board']]);
  const keys = (map: Map<string, Value>): string[] => [...map.keys()];

  it('places the context after csrf when the read paths keep csrf', () => {
    const shared = new Map<string, Value>([['title', 'T'], ['csrf', 'c'], ['site', 'S']]);
    expect(keys(withContext(shared, held))).toEqual(['title', 'csrf', 'context', 'site']);
  });

  it('places the context right after title when the read paths removed csrf', () => {
    const shared = new Map<string, Value>([['title', 'T'], ['site', 'S']]);
    expect(keys(withContext(shared, held))).toEqual(['title', 'context', 'site']);
  });

  it('never places the context before title', () => {
    const shared = new Map<string, Value>([['title', 'T']]);
    expect(keys(withContext(shared, held))[0]).toBe('title');
  });

  it('places the context first only when neither title nor csrf is kept', () => {
    const shared = new Map<string, Value>([['site', 'S']]);
    expect(keys(withContext(shared, held))).toEqual(['context', 'site']);
  });
});
