// The steps of contracts/client.json (HY-62): one server answers the client-rendered and the server-rendered pages of the
// fixture manifest with the client fixture handlers, and refuses a client rendering that it cannot open. PHP and Python
// pass the same cases with the same handlers.
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Csrf } from '../../src/csrf.js';
import { App, ArraySession, Representation, Result, type AppOptions, type Choice, type ClientRendering, type Handlers, type Loader, type RepresentationHandler, type Request, type RouteHandlers } from '../../src/index.js';
import { requestOf } from '../../src/http-host.js';
import type { CaseReader } from '../case-reader.js';
import { FIXTURES, list, parsed, plain, record, TEMPLATES, TOKEN, type Services } from '../support.js';
import { mapOf, Recorded, RecordingStore, textOf, textsOf } from './recorded.js';

// What the representation handlers of a case received: the number of their calls, and the media parameters and the
// request of the last call.
interface Calls {
  handled: number;
  parameters: ReadonlyMap<string, string> | null;
  request: Request | null;
}

// Returns a representation handler that answers `response` and records its calls and what it receives (HY-122).
function representation(calls: Calls, response: Map<string, unknown>): RepresentationHandler<Services> {
  return ({ request, media }) => {
    calls.handled++;
    calls.parameters = media.parameters();
    calls.request = request;
    const status = response.get('status');
    if (typeof status !== 'number') throw new Error('the status of a handler of the case is not a number');
    return new Representation(status, response.get('body') ?? null, response.has('headers') ? textsOf(response.get('headers'), 'the headers of a handler of the case') : {});
  };
}

// Returns the client fixture handlers, the one handler set of the three servers: the region `side`, the loads of `home`
// and `item`, the action of `add` and the route region `rows` of `list`, and no shared handler.
export function fixtureHandlers(): { regions: Record<string, Loader<Services>>; routes: Record<string, RouteHandlers<Services>> } {
  return {
    regions: {
      side: ({ services }) => ({ count: services.get('counter').count, note: null }),
    },
    routes: {
      home: { load: ({ services }) => ({ name: `n${services.get('counter').count}` }) },
      add: {
        post: ({ request, services }) => {
          const counter = services.get('counter');
          counter.actions++;
          if (request.formString('name') === 'taken') return Result.page(409, { name: 'taken', error: 'conflict' });
          counter.count++;
          return Result.redirect('/');
        },
      },
      list: { regions: { rows: () => ({ items: [], open: false, mode: 'a', view: 'x', filter: { a: 1 }, tags: [] }) } },
      item: { load: ({ request }) => ({ id: request.param('id') }) },
    },
  };
}

// Returns the client fixture handlers with a shared handler that returns an empty map, each recording its name and the
// selection value of the request that it received before it runs (HY-62).
function observing(handlers: ReturnType<typeof fixtureHandlers>, observed: [string, unknown][]): Handlers<Services> {
  const noted = <A extends { request: Request }, R>(name: string, handler: (argument: A) => R) => (argument: A): R => {
    observed.push([name, argument.request.selection()]);
    return handler(argument);
  };
  const routes: Record<string, RouteHandlers<Services>> = {};
  for (const [name, route] of Object.entries(handlers.routes)) {
    routes[name] = {
      ...(route.load === undefined ? {} : { load: noted(`load:${name}`, route.load) }),
      ...(route.post === undefined ? {} : { post: noted(`action:${name}`, route.post) }),
      ...(route.regions === undefined ? {} : { regions: Object.fromEntries(Object.entries(route.regions).map(([region, loader]) => [region, noted(`region:${region}`, loader)])) }),
    };
  }
  return {
    shared: noted('shared', () => ({})),
    regions: Object.fromEntries(Object.entries(handlers.regions).map(([region, loader]) => [region, noted(`region:${region}`, loader)])),
    routes,
  };
}

// Writes the manifest of the fixture application with the representations that the fixture declares for its routes, and
// returns its path in `directory`, with the handlers of those entries added to `handlers`. Each entry answers the
// response `handler` of the case, or its own.
function declared(directory: string, handlers: Handlers<Services>, representations: Map<string, unknown>, handler: Map<string, unknown> | null, calls: Calls): { manifest: string; handlers: Handlers<Services> } {
  const manifest = join(directory, 'app.json');
  const document = record(parsed(readFileSync(`${FIXTURES}app.json`, 'utf8')));
  const routes = { ...handlers.routes };
  for (const route of list(document.routes).map(record)) {
    const name = textOf(route.name, 'a route name of the fixture manifest');
    if (!representations.has(name)) continue;
    const entries = list(representations.get(name)).map((entry) => mapOf(entry, `a representation of ${name}`));
    route.representations = entries.map((entry) => plain(new Map([...entry].filter(([key]) => key !== 'handler'))));
    routes[name] = {
      ...routes[name],
      representations: Object.fromEntries(entries.map((entry) => [textOf(entry.get('type'), 'the type of a representation'), representation(calls, handler ?? mapOf(entry.get('handler'), 'the handler of a representation'))])),
    };
  }
  writeFileSync(manifest, JSON.stringify(document));
  return { manifest, handlers: { ...handlers, routes } };
}

// Returns the selection of a case by its name; `host` chooses the request whose Host header is the chosen host. The
// selections other than `host`, `hostValue` and `promiseHost` return what is no choice, which the server checks at run
// time (HY-62.11).
function selection(name: string, chosenHost: string): ClientRendering['selects'] {
  const host = (request: Request): Choice => ({ chosen: request.header('Host') === chosenHost, value: null });
  switch (name) {
    case 'host':
      return host;
    case 'hostValue':
      return (request) => ({ chosen: request.header('Host') === chosenHost, value: new Map([['host', request.header('Host') ?? '']]) });
    case 'text':
      // @ts-expect-error -- a text is no choice
      return () => 'csr';
    case 'boolean':
      // @ts-expect-error -- a boolean is no choice
      return () => true;
    case 'throws':
      return () => {
        throw new Error('selection');
      };
    case 'chosenNotBoolean':
      // @ts-expect-error -- a choice whose chosen is a text is no choice
      return () => ({ chosen: 'yes', value: null });
    case 'valueUndefined':
      return () => ({ chosen: true, value: undefined });
    case 'promiseHost':
      return (request) => Promise.resolve(host(request));
    case 'promiseRejects':
      return () => Promise.reject(new Error('selection'));
    case 'promiseText':
      // @ts-expect-error -- a promise of a text is no promise of a choice
      return () => Promise.resolve('csr');
    case 'promiseBoolean':
      // @ts-expect-error -- a promise of a boolean is no promise of a choice
      return () => Promise.resolve(true);
    case 'promiseWithoutValue':
      // @ts-expect-error -- a choice without a value is no choice
      return () => Promise.resolve({ chosen: true });
    default:
      throw new Error(`the selection ${name} of the case is unknown`);
  }
}

// Returns the options of `open` that a case states: `bodyLimit` and `frameAncestors`, and fails for another name.
function optionsOf(reader: CaseReader): Pick<AppOptions<Services>, 'bodyLimit' | 'frameAncestors'> {
  const options: Pick<AppOptions<Services>, 'bodyLimit' | 'frameAncestors'> = {};
  if (!reader.has('options')) return options;
  const stated = reader.input('options');
  if (!(stated instanceof Map)) throw new Error('the case field options is not a map');
  for (const [name, value] of stated) {
    if (name === 'bodyLimit' && typeof value === 'number') options.bodyLimit = value;
    else if (name === 'frameAncestors' && typeof value === 'string') options.frameAncestors = value;
    else throw new Error(`the option ${String(name)} of the case is unknown or has a value of another type`);
  }
  return options;
}

// Returns true when the process can read a file.
function readable(file: string): boolean {
  try {
    readFileSync(file);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EACCES') return false;
    throw error;
  }
}

// Returns an input or a fixture of a case that is a string, and fails for any other value.
function textInput(reader: CaseReader, name: string): string {
  return textOf(reader.input(name), `the case field ${name}`);
}

export const steps = {
  async cases(reader: CaseReader): Promise<void> {
    const basePath = textInput(reader, 'basePath');
    const chosenHost = textInput(reader, 'chosenHost');
    const shell = textInput(reader, 'shell');
    const inner = new ArraySession();
    const store = new RecordingStore(inner);
    const counter = { count: 0, actions: 0 };
    const headers = textsOf(reader.input('request.headers'), 'the case field request.headers');
    const method = textInput(reader, 'request.method');
    const target = textInput(reader, 'request.target');
    const csrf = reader.has('request.csrf') && reader.input('request.csrf') === true;
    let fields = reader.has('request.form') ? textsOf(reader.input('request.form'), 'the case field request.form') : undefined;
    if (csrf) {
      // The token goes to the inner store, which records no call; a `_csrf` of the form replaces the masked value.
      inner.set('_hyper_csrf', TOKEN);
      fields = { _csrf: Csrf.masked(TOKEN), ...fields };
    }
    // A stated form sends its media type and the urlencoded form; a stated body replaces the body of the form.
    const sent = fields === undefined ? headers : { 'Content-Type': 'application/x-www-form-urlencoded', ...headers };
    const form = fields === undefined ? undefined : Buffer.from(new URLSearchParams(fields).toString(), 'latin1');
    const body = reader.has('request.body') ? Buffer.from(textInput(reader, 'request.body'), 'utf8') : form;
    const calls: Calls = { handled: 0, parameters: null, request: null };
    const observed: [string, unknown][] = [];
    const recorded = new Recorded();
    let selections = 0;
    const selects = selection(reader.has('selects') ? textInput(reader, 'selects') : 'host', chosenHost);
    const directory = mkdtempSync(join(tmpdir(), 'hyper-client-'));
    let response;
    try {
      const shellFile = join(directory, 'index.html');
      writeFileSync(shellFile, shell);
      const fixture = fixtureHandlers();
      const application = declared(
        directory,
        reader.has('observed') ? observing(fixture, observed) : fixture,
        mapOf(reader.input('representations'), 'the fixture representations'),
        reader.has('handler') ? mapOf(reader.input('handler'), 'the case field handler') : null,
        calls,
      );
      const app = await App.open<Services>({
        manifest: application.manifest,
        build: `${FIXTURES}build.json`,
        templates: TEMPLATES,
        handlers: application.handlers,
        timezone: '+09:00',
        log: recorded.log,
        onResponse: recorded.onResponse,
        clientRendering: {
          shell: shellFile,
          basePath,
          selects: (request) => {
            selections++;
            return selects(request);
          },
        },
        ...optionsOf(reader),
      });
      app.bind('counter', () => counter);
      response = await app.handle(requestOf({ method, target, headers: sent, ...(body === undefined ? {} : { body }) }), store);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
    reader.compare('status', response.status);
    reader.compare('headers', response.headers);
    reader.compare('allHeaders', response.headers);
    reader.compare('body', response.body);
    reader.compare('bodyContains', response.body);
    reader.compare('bodyNotContains', response.body);
    reader.compare('absentHeaders', response.headers);
    if (reader.has('json')) {
      const json = record(parsed(response.body));
      reader.compare('json.route', json.route);
      reader.compare('json.params', json.params);
      reader.compare('json.regions', record(json.regions));
    }
    reader.compare('session', inner.get('_hyper_csrf') !== undefined);
    reader.compare('actions', counter.actions);
    reader.compare('handled', calls.handled);
    reader.compare('selections', selections);
    reader.compare('observed', observed);
    recorded.compare(reader, store);
    if (!reader.has('received')) return;
    // The headers that the handler received are among the headers of the request.
    const received: Record<string, string> = {};
    for (const name of Object.keys(headers)) {
      const value = calls.request?.header(name) ?? null;
      if (value !== null) received[name] = value;
    }
    reader.compare('received.parameters', calls.parameters);
    reader.compare('received.selection', calls.request?.selection());
    reader.compare('received.absentHeaders', received);
  },

  // Opens the fixture application with the client rendering of the case, whose shell file the step writes into a
  // directory of its own, and compares the error of the open and its message.
  async openRejections(reader: CaseReader): Promise<void> {
    const basePath = textInput(reader, 'basePath');
    const text = textInput(reader, 'shell');
    const meta = (base: string): string => `<meta name="hyper-api" content="${base}">`;
    if (text.split(meta(basePath)).length !== 2) throw new Error('the fixture shell does not declare the fixture base path exactly once');
    const dataBasePath = reader.has('dataBasePath') ? textInput(reader, 'dataBasePath') : basePath;
    const directory = mkdtempSync(join(tmpdir(), 'hyper-client-'));
    let failure: unknown = null;
    try {
      const file = join(directory, 'index.html');
      let shell: string;
      switch (reader.input('shellFile')) {
        case 'declared':
          writeFileSync(file, text.replace(meta(basePath), meta(dataBasePath)));
          shell = file;
          break;
        case 'other-base':
          writeFileSync(file, text.replace(meta(basePath), meta('/api')));
          shell = file;
          break;
        case 'relative':
          shell = 'tests/fixtures/shell/index.html';
          break;
        case 'missing':
          shell = join(directory, 'missing.html');
          break;
        case 'directory':
          shell = directory;
          break;
        case 'unreadable':
          writeFileSync(file, text);
          chmodSync(file, 0);
          // A privileged user reads a file of mode 0, so the case would pass without its check.
          if (readable(file)) throw new Error('the process reads a file of mode 0, so the case cannot state a shell that cannot be read');
          shell = file;
          break;
        case 'not-utf8':
          writeFileSync(file, Buffer.concat([Buffer.from(text, 'utf8'), Buffer.from([0xff, 0xfe])]));
          shell = file;
          break;
        default:
          throw new Error('the shell file of the case is unknown');
      }
      try {
        await App.open<Services>({
          manifest: `${FIXTURES}app.json`,
          build: `${FIXTURES}build.json`,
          templates: TEMPLATES,
          handlers: fixtureHandlers(),
          timezone: '+09:00',
          log: () => {},
          clientRendering: { shell, basePath: dataBasePath, selects: () => ({ chosen: true, value: null }) },
        });
      } catch (error) {
        failure = error;
      }
    } finally {
      // A mode that lets the step remove the file of the case `unreadable`.
      if (reader.input('shellFile') === 'unreadable') chmodSync(join(directory, 'index.html'), 0o600);
      rmSync(directory, { recursive: true, force: true });
    }
    reader.outcome('open', failure);
    reader.compare('openError', failure instanceof Error ? failure.message : '');
  },
};
