// The steps of contracts/representations.json (HY-116 to HY-122): the manifest and open rejections, and the cases of
// the representations application, which run through the app with the handlers of the contract.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App, MemorySessionStore, Representation, Request, type Handlers, type RepresentationHandler, type RouteHandlers } from '../../src/index.js';
import type { Value } from '../../src/values.js';
import type { CaseReader } from '../case-reader.js';
import { OrmError, parsed, plain, record } from '../support.js';

const PROGRAMS = fileURLToPath(new URL('../../../../../var/contract-programs/', import.meta.url));
const APPLICATION = 'representations';

// The error of a rejected open, or null when the open did not fail.
function failureOf(open: Promise<unknown>): Promise<unknown> {
  return open.then(
    () => null,
    (error: unknown) => error,
  );
}

// What a representation handler received: the method, the media parameters, the request and the decoded JSON body.
interface Observed {
  method: string;
  parameters: ReadonlyMap<string, string>;
  request: Request;
  body: Value;
}

type None = Record<string, never>;

// A handler of a rejection case, which no request reaches.
const rejected: RepresentationHandler<None> = () => {
  throw new Error('a representation handler of a rejection case is called');
};

// Returns the representation handler of a case: it records what it received, and answers or throws what the case
// states.
function handlerOf(spec: Map<string, unknown> | null, calls: Observed[]): RepresentationHandler<None> {
  return ({ request, media }) => {
    calls.push({ method: request.method, parameters: media.parameters(), request, body: request.json() });
    if (spec === null) throw new Error('a case without a handler calls a representation handler');
    const thrown = spec.get('throw');
    if (thrown instanceof Map) {
      if (thrown.get('class') !== 'OrmError') throw new Error(`the case throws an unknown class ${String(thrown.get('class'))}`);
      throw new OrmError(thrown.get('code') as string);
    }
    const headers = spec.get('headers');
    return new Representation(spec.get('status') as number, spec.get('body') ?? null, headers instanceof Map ? Object.fromEntries(headers as Map<string, string>) : {});
  };
}

// Returns the paths of the representations program and its handlers: each route loads the data of `loaders`, and has a
// representation handler for each type of `types`.
function programOf(manifest: string, loaders: Map<string, unknown>, types: Map<string, string[]>, handler: RepresentationHandler<None>): { manifest: string; build: string; templates: { index: string; root: string }; handlers: Handlers<None> } {
  const dir = join(PROGRAMS, APPLICATION);
  const routes: Record<string, RouteHandlers<None>> = {};
  for (const [name, declared] of types) {
    const data = loaders.get(name);
    routes[name] = {
      load: () => (data instanceof Map ? new Map(data as Map<string, Value>) : new Map<string, Value>()),
      representations: Object.fromEntries(declared.map((type) => [type, handler])),
    };
  }
  return {
    manifest,
    build: join(dir, 'build.json'),
    templates: { index: join(dir, 'node', 'templates.index.json'), root: join(dir, 'node') },
    handlers: { routes },
  };
}

// Returns the representation types that each route of the manifest of the program declares, by the route name.
function declaredTypes(): Map<string, string[]> {
  const document = record(parsed(readFileSync(join(PROGRAMS, APPLICATION, 'manifest.json'), 'utf8')));
  const types = new Map<string, string[]>();
  for (const route of document.routes as { name: string; representations?: { type: string }[] }[]) {
    types.set(route.name, (route.representations ?? []).map((entry) => entry.type));
  }
  return types;
}

// The loaders of the representations application of the contract, by the route name.
function loadersOf(reader: CaseReader): Map<string, unknown> {
  const application = (reader.input('applications') as Map<string, Map<string, unknown>>).get(APPLICATION);
  return application?.get('loaders') as Map<string, unknown>;
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
    // The route has a handler for each type that the case declares, so that only the manifest check fails the open.
    const types = declaredTypes();
    types.set(route, Array.isArray(representations) ? representations.map((entry: unknown) => String(record(entry).type)) : []);
    try {
      const failure = await failureOf(App.open<None>({ ...programOf(copy.file, loadersOf(reader), types, rejected), timezone: '+09:00', log: () => {} }));
      reader.outcome('open', failure);
    } finally {
      rmSync(copy.directory, { recursive: true, force: true });
    }
  },

  async openRejections(reader: CaseReader): Promise<void> {
    const types = declaredTypes();
    types.set(reader.input('route') as string, reader.input('handlers') as string[]);
    const failure = await failureOf(App.open<None>({ ...programOf(join(PROGRAMS, APPLICATION, 'manifest.json'), loadersOf(reader), types, rejected), timezone: '+09:00', log: () => {} }));
    reader.outcome('open', failure);
  },

  async cases(reader: CaseReader): Promise<void> {
    const calls: Observed[] = [];
    const spec = reader.has('handler') ? (reader.input('handler') as Map<string, unknown>) : null;
    const app = await App.open<None>({
      ...programOf(join(PROGRAMS, APPLICATION, 'manifest.json'), loadersOf(reader), declaredTypes(), handlerOf(spec, calls)),
      timezone: '+09:00',
      basePath: reader.has('basePath') ? (reader.input('basePath') as string) : '',
      log: () => {},
    });
    const store = new MemorySessionStore();
    const headers = Object.fromEntries(reader.input('request.headers') as Map<string, string>);
    const body = reader.has('request.body') ? Buffer.from(reader.input('request.body') as string, 'utf8') : undefined;
    const response = await app.handle(
      Request.from({ method: reader.input('request.method') as string, target: reader.input('request.target') as string, headers, body }),
      store,
    );
    const observed = calls.at(-1);
    // The headers that the handler received are among the headers of the request.
    const received: Record<string, string> = {};
    for (const name of Object.keys(headers)) {
      const value = observed?.request.header(name) ?? null;
      if (value !== null) received[name] = value;
    }
    reader.compare('status', response.status);
    reader.compare('headers', response.headers);
    reader.compare('absentHeaders', response.headers);
    reader.compare('body', response.body);
    reader.compare('page', String(response.headers['Content-Type'] ?? '').split(';')[0]);
    reader.compare('handled', calls.length);
    reader.compare('session', store.get('_hyper_csrf') !== undefined);
    if (!reader.has('received')) return;
    reader.compare('received.method', observed?.method);
    reader.compare('received.parameters', observed?.parameters);
    reader.compare('received.body', observed?.body);
    reader.compare('received.headers', received);
    reader.compare('received.absentHeaders', received);
  },
};
