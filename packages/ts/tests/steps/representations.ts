// The steps of contracts/representations.json (HY-116 to HY-122): the manifest and open rejections, and the cases of
// the representations application, which run through the app with the handlers of the contract.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App, ArraySession, Representation, Request, type Handlers, type RepresentationArgument, type RepresentationHandler, type RouteHandlers } from '../../src/index.js';
import type { Value } from '../../src/data/values.js';
import type { CaseReader } from '../case-reader.js';
import { parsed } from '../case-rules.js';
import { mapOf, plain, stringsOf, textOf, textsOf } from '../inputs.js';
import { list, OrmError, parsedBody, record, requestFrom } from '../support.js';
import { failureOf, messageStart } from './recorded.js';

const PROGRAMS = fileURLToPath(new URL('../../../../var/contract-programs/', import.meta.url));
const APPLICATION = 'representations';

// What a representation handler received: the method, the media parameters, the request, the decoded JSON body, the
// route parameters and the service that the case names, or null.
interface Observed {
  method: string;
  parameters: ReadonlyMap<string, string>;
  request: Request;
  body: Value;
  params: Record<string, string>;
  service: object | null;
}

// The services of the application of a case, by the names of contracts/container.json.
interface Services {
  clock: object;
  mailer: object;
}

// Returns a service name of a case, and fails for any other value.
function serviceName(value: unknown): keyof Services {
  if (value !== 'clock' && value !== 'mailer') throw new Error(`the case names the unknown service ${String(value)}`);
  return value;
}

// A handler of a rejection case, which no request reaches.
const rejected: RepresentationHandler<Services> = () => {
  throw new Error('a representation handler of a rejection case is called');
};

// Returns the representation handler of a case: it records what it received, with the service that `handler.service`
// names (HY-105), and answers or throws what the case states.
function handlerOf(spec: Map<string, unknown> | null, calls: Observed[]): RepresentationHandler<Services> {
  const service = spec?.has('service') === true ? serviceName(spec.get('service')) : null;
  return (argument: RepresentationArgument<Services>) => {
    const { request, media, services } = argument;
    calls.push({ method: request.method, parameters: media.parameters(), request, body: request.json(), params: request.params(), service: service === null ? null : services.get(service) });
    if (spec === null) throw new Error('a case without a handler calls a representation handler');
    const thrown = spec.get('throw');
    if (thrown instanceof Map) {
      if (thrown.get('class') !== 'OrmError') throw new Error(`the case throws an unknown class ${String(thrown.get('class'))}`);
      throw new OrmError(textOf(thrown.get('code'), 'the code'));
    }
    const status = spec.get('status');
    if (typeof status !== 'number') throw new Error('the status of the handler of the case is not a number');
    return new Representation(status, spec.get('body') ?? null, spec.has('headers') ? textsOf(spec.get('headers'), 'the headers of the handler') : {});
  };
}

// Returns the paths of the representations program and its handlers: each route loads the data of `loaders`, and has a
// representation handler for each type of `types`.
function programOf(manifest: string, loaders: Map<string, unknown>, types: Map<string, string[]>, handler: RepresentationHandler<Services>): { manifest: string; build: string; templates: { index: string; root: string }; handlers: Handlers<Services> } {
  const dir = join(PROGRAMS, APPLICATION);
  const routes: Record<string, RouteHandlers<Services>> = {};
  for (const [name, declared] of types) {
    const data = loaders.get(name);
    routes[name] = {
      load: () => (data === undefined ? new Map<string, unknown>() : mapOf(data, `the loader ${name}`)),
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
  const document = record(parsedBody(readFileSync(join(PROGRAMS, APPLICATION, 'manifest.json'), 'utf8')));
  const types = new Map<string, string[]>();
  for (const route of list(document.routes).map(record)) {
    const entries = route.representations === undefined ? [] : list(route.representations).map(record);
    types.set(textOf(route.name, 'the name of a route'), entries.map((entry) => textOf(entry.type, 'the type of a representation')));
  }
  return types;
}

// The loaders of the representations application of the contract, by the route name.
function loadersOf(reader: CaseReader): Map<string, unknown> {
  const application = mapOf(mapOf(reader.input('applications'), 'applications').get(APPLICATION), APPLICATION);
  return mapOf(application.get('loaders'), 'loaders');
}

// Writes a copy of the manifest of the representations program whose route states the given representations, and returns
// the path of the copy in a directory that the caller removes.
function manifestWith(route: string, representations: unknown): { file: string; directory: string } {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-representations-'));
  const file = join(directory, 'manifest.json');
  const document = record(parsedBody(readFileSync(join(PROGRAMS, APPLICATION, 'manifest.json'), 'utf8')));
  const target = list(document.routes).map(record).find((item) => item.name === route);
  if (target === undefined) throw new Error(`the contract has no route ${route}`);
  target.representations = representations;
  writeFileSync(file, JSON.stringify(document));
  return { file, directory };
}

export const steps = {
  // Makes a representation with one, two or three arguments of its public constructor, as the case holds them, and
  // compares its members (HY-122.1).
  values(reader: CaseReader): void {
    const status = reader.input('status');
    if (typeof status !== 'number' || !Number.isInteger(status)) throw new Error('the case field status is not an integer');
    let held: Representation;
    if (!reader.has('body')) held = new Representation(status);
    else {
      const body = parsed(textOf(reader.input('body'), 'body'));
      held = reader.has('headers') ? new Representation(status, body, textsOf(reader.input('headers'), 'headers')) : new Representation(status, body);
    }
    reader.compare('held', { status: held.status, body: held.body, headers: held.headers });
  },
  async manifestRejections(reader: CaseReader): Promise<void> {
    const route = textOf(reader.input('route'), 'route');
    const representations = plain(reader.input('representations'));
    const copy = manifestWith(route, representations);
    // The route has a handler for each type that the case declares, so that only the manifest check fails the open.
    const types = declaredTypes();
    types.set(route, Array.isArray(representations) ? representations.map((entry: unknown) => String(record(entry).type)) : []);
    try {
      const failure = await failureOf(App.open<Services>({ ...programOf(copy.file, loadersOf(reader), types, rejected), timezone: '+09:00', log: () => {} }));
      reader.outcome('open', failure);
      messageStart(reader, failure);
    } finally {
      rmSync(copy.directory, { recursive: true, force: true });
    }
  },

  async openRejections(reader: CaseReader): Promise<void> {
    const types = declaredTypes();
    types.set(textOf(reader.input('route'), 'route'), stringsOf(reader.input('handlers'), 'handlers'));
    const failure = await failureOf(App.open<Services>({ ...programOf(join(PROGRAMS, APPLICATION, 'manifest.json'), loadersOf(reader), types, rejected), timezone: '+09:00', log: () => {} }));
    reader.outcome('open', failure);
    messageStart(reader, failure);
  },

  async cases(reader: CaseReader): Promise<void> {
    const calls: Observed[] = [];
    const spec = reader.has('handler') ? mapOf(reader.input('handler'), 'handler') : null;
    const app = await App.open<Services>({
      ...programOf(join(PROGRAMS, APPLICATION, 'manifest.json'), loadersOf(reader), declaredTypes(), handlerOf(spec, calls)),
      timezone: '+09:00',
      basePath: reader.has('basePath') ? textOf(reader.input('basePath'), 'basePath') : '',
      log: () => {},
    });
    // Each bound service is one object, which its factory creates once and the step remembers.
    const bound = new Map<keyof Services, object>();
    const names: unknown = reader.has('bound') ? reader.input('bound') : [];
    if (!Array.isArray(names)) throw new Error('the case field bound is not a list');
    for (const name of names.map(serviceName)) {
      app.bind(name, () => {
        const made = {};
        bound.set(name, made);
        return made;
      });
    }
    const store = new ArraySession();
    const headers = textsOf(reader.input('request.headers'), 'request.headers');
    const body = reader.has('request.body') ? Buffer.from(textOf(reader.input('request.body'), 'request.body'), 'utf8') : undefined;
    const response = await app.handle(
      requestFrom({ method: textOf(reader.input('request.method'), 'request.method'), target: textOf(reader.input('request.target'), 'request.target'), headers, ...(body === undefined ? {} : { body }) }),
      store,
    );
    const observed: Observed | undefined = calls.at(-1);
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
    reader.compare('received.browser', observed === undefined ? null : observed.request.browser());
    reader.compare('received.parameters', observed?.parameters);
    reader.compare('received.body', observed?.body);
    reader.compare('received.headers', received);
    reader.compare('received.absentHeaders', received);
    // The handler received the very object that the factory of the named service returned.
    const named = spec?.has('service') === true ? serviceName(spec.get('service')) : null;
    reader.compare('received.service', named !== null && observed !== undefined && observed.service !== null && bound.get(named) === observed.service);
    reader.compare('received.params', observed?.params);
  },
};
