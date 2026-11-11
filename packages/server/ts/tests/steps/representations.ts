// The steps of contracts/representations.json (HY-116 to HY-122): the selection of a representation, the manifest checks
// and the open of an application whose representation handlers are wrong. The Node server has no representation handler
// yet (H28.7), so the cases that state the calls of one fail on the fields that the server does not report.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App, MemorySessionStore, Request, Result, type Handlers, type RouteHandlers } from '../../src/index.js';
import type { Value } from '../../src/values.js';
import type { CaseReader } from '../case-reader.js';
import { parsed, record } from '../support.js';

const PROGRAMS = fileURLToPath(new URL('../../../../../var/contract-programs/', import.meta.url));
const APPLICATION = 'representations';

// Converts the Maps of a parsed contract value into plain objects, the shape the manifest file holds.
function plain(value: unknown): unknown {
  if (value instanceof Map) return Object.fromEntries([...value].map(([key, item]) => [key, plain(item)]));
  if (Array.isArray(value)) return value.map(plain);
  return value;
}

// The error of a rejected open, or null when the open did not fail.
function failureOf(open: Promise<unknown>): Promise<unknown> {
  return open.then(
    () => null,
    (error: unknown) => error,
  );
}

// Returns the paths of the representations program and its handlers: each route loads an empty record, and each route
// that the manifest states as a POST answers with an empty page.
function programOf(manifest: string): { manifest: string; build: string; templates: { index: string; root: string }; handlers: Handlers<Record<string, never>> } {
  const dir = join(PROGRAMS, APPLICATION);
  const document = record(parsed(readFileSync(manifest, 'utf8')));
  const routes: Record<string, RouteHandlers<Record<string, never>>> = {};
  for (const route of document.routes as { name: string; post?: boolean }[]) {
    routes[route.name] = route.post === true ? { load: () => new Map<string, Value>(), post: () => Result.page(200, {}) } : { load: () => new Map<string, Value>() };
  }
  return {
    manifest,
    build: join(dir, 'build.json'),
    templates: { index: join(dir, 'node', 'templates.index.json'), root: join(dir, 'node') },
    handlers: { routes },
  };
}

// Writes a copy of the manifest of the representations program whose route states the given representations, and returns
// the path of the copy in a directory that the caller removes.
function manifestWith(route: string, representations: unknown): { file: string; directory: string } {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-representations-'));
  const file = join(directory, 'manifest.json');
  const document = record(parsed(readFileSync(join(PROGRAMS, APPLICATION, 'manifest.json'), 'utf8')));
  const routes = document.routes as { name: string; representations?: unknown }[];
  const target = routes.find((item) => item.name === route);
  if (target === undefined) throw new Error(`the contract has no route ${route}`);
  target.representations = representations;
  writeFileSync(file, JSON.stringify(document));
  return { file, directory };
}

export const steps = {
  async manifestRejections(reader: CaseReader): Promise<void> {
    const route = reader.input('route') as string;
    const representations = plain(reader.input('representations'));
    const copy = manifestWith(route, representations);
    try {
      const failure = await failureOf(App.open<Record<string, never>>({ ...programOf(copy.file), timezone: '+09:00', log: () => {} }));
      reader.outcome('open', failure);
    } finally {
      rmSync(copy.directory, { recursive: true, force: true });
    }
  },

  async openRejections(reader: CaseReader): Promise<void> {
    // The handler types of the route are not part of the Node handler options yet (H28.7), so they are not read here and
    // the case fails as uncompared.
    const failure = await failureOf(App.open<Record<string, never>>({ ...programOf(join(PROGRAMS, APPLICATION, 'manifest.json')), timezone: '+09:00', log: () => {} }));
    reader.outcome('open', failure);
  },

  async cases(reader: CaseReader): Promise<void> {
    const app = await App.open<Record<string, never>>({ ...programOf(join(PROGRAMS, APPLICATION, 'manifest.json')), timezone: '+09:00', log: () => {} });
    const store = new MemorySessionStore();
    const headers = Object.fromEntries(reader.input('request.headers') as Map<string, string>);
    const body = reader.has('request.body') ? Buffer.from(reader.input('request.body') as string, 'latin1') : undefined;
    const response = await app.handle(
      Request.from({ method: reader.input('request.method') as string, target: reader.input('request.target') as string, headers, body }),
      store,
    );
    reader.compare('status', response.status);
    reader.compare('headers', response.headers);
    reader.compare('absentHeaders', response.headers);
    reader.compare('body', response.body);
    reader.compare('page', String(response.headers['Content-Type'] ?? '').split(';')[0]);
    reader.compare('session', store.get('_hyper_csrf') !== undefined);
    // The representation handler calls are not observable through the Node server yet (H28.7): the field is not compared.
  },
};
