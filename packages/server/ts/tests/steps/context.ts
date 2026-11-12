// The steps of contracts/context.json (HY-124 to HY-128): the context hashes and the requests that an application with or
// without a context answers. Every expected value comes from the contract.
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Context, type ContextHandler } from '../../src/context.js';
import { Csrf } from '../../src/csrf.js';
import { JsonCodec } from '../../src/json-codec.js';
import { hostValue } from './host-value.js';
import { App, ArraySession, NotFound, Request, Result, type Handlers, type Reply, type RouteHandlers } from '../../src/index.js';
import type { Value } from '../../src/values.js';
import type { CaseReader } from '../case-reader.js';
import { OrmError, parsed, record } from '../support.js';
import { requestOf } from '../../src/http.js';

// An action of an application of a case: it renews the session when `renew` is true, and then raises the ORM error of
// the code `raises`, redirects, or returns a page with its data.
interface Action {
  renew: boolean;
  raises: string | null;
  redirect: string | null;
  page: number;
  data: Map<string, unknown>;
}

// An application of a case, read by applicationOf: an absent `shared`, `actions`, `embedData` or `context` declares
// none.
interface Application {
  routes: { name: string; regions: string[] }[];
  loaders: Map<string, Map<string, unknown>>;
  embedData: string[];
  actions: Map<string, Action>;
  shared: Map<string, unknown> | null;
  context: string | null;
}

// The applications of the contracts, built once for the three servers by scripts/contract-programs.mts (HY-124, HYC-24).
const PROGRAMS = fileURLToPath(new URL('../../../../../var/contract-programs/', import.meta.url));


// Returns a map of an application, and fails for any other value.
function mapIn(value: unknown, what: string): Map<string, unknown> {
  if (!(value instanceof Map)) throw new Error(`${what} is not a map`);
  const map = new Map<string, unknown>();
  for (const [key, item] of value) {
    if (typeof key !== 'string') throw new Error(`${what} has a key that is not a string`);
    map.set(key, item);
  }
  return map;
}

// Returns a string of an application, and fails for any other value.
function stringIn(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`${what} is not a string`);
  return value;
}

// Returns a list of strings of an application, and fails for any other value.
function stringsIn(value: unknown, what: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${what} is not a list of strings`);
  return value.map((item: unknown) => stringIn(item, `an item of ${what}`));
}

// Reads an application of a case by the rule of the three languages: an absent `shared`, `actions`, `embedData` or
// `context` declares none, a present member must have its type, and an action has `redirect` or an integer `page` with
// `data`.
function applicationOf(value: unknown, name: string): Application {
  const application = mapIn(value, `the application ${name}`);
  const manifest = mapIn(application.get('manifest'), 'the manifest');
  const routes = (() => {
    const list = manifest.get('routes');
    if (!Array.isArray(list)) throw new Error('the routes of the manifest are not a list');
    return list.map((item: unknown) => {
      const route = mapIn(item, 'a route');
      const regions = route.has('regions') ? route.get('regions') : [];
      if (!Array.isArray(regions)) throw new Error('the regions of a route are not a list');
      return { name: stringIn(route.get('name'), 'a route name'), regions: regions.map((region: unknown) => stringIn(mapIn(region, 'a region').get('name'), 'a region name')) };
    });
  })();
  const loaders = new Map([...mapIn(application.get('loaders'), 'the loaders')].map(([loader, data]): [string, Map<string, unknown>] => [loader, hostMap(data, `the loader ${loader}`)]));
  const actions = new Map<string, Action>();
  if (application.has('actions')) {
    for (const [route, item] of mapIn(application.get('actions'), 'the actions')) {
      const action = mapIn(item, `the action of ${route}`);
      const renew = action.has('renew') && action.get('renew') === true;
      if (action.has('throw')) {
        actions.set(route, { renew, raises: raisedCode(action.get('throw'), `the action of ${route}`), redirect: null, page: 0, data: new Map() });
        continue;
      }
      if (action.has('redirect')) {
        actions.set(route, { renew, raises: null, redirect: stringIn(action.get('redirect'), `the redirect of ${route}`), page: 0, data: new Map() });
        continue;
      }
      const page = action.get('page');
      if (typeof page !== 'number' || !Number.isInteger(page)) throw new Error(`the action of ${route} has no throw, no redirect and no integer page`);
      actions.set(route, { renew, raises: null, redirect: null, page, data: hostMap(action.get('data'), `the data of the action of ${route}`) });
    }
  }
  return {
    routes,
    loaders,
    embedData: application.has('embedData') ? stringsIn(application.get('embedData'), 'embedData') : [],
    actions,
    shared: application.has('shared') ? hostMap(application.get('shared'), 'the shared data') : null,
    context: application.has('context') ? stringIn(application.get('context'), 'the context') : null,
  };
}

// Returns the code of a `throw` of a loader or an action, which names the ORM error of Node (HY-107.2), and fails for
// any other value.
function raisedCode(value: unknown, what: string): string {
  const thrown = mapIn(value, `the throw of ${what}`);
  if (thrown.get('class') !== 'OrmError') throw new Error(`${what} throws an unknown class ${String(thrown.get('class'))}`);
  return stringIn(thrown.get('code'), `the code of the throw of ${what}`);
}

// Returns what a loader of a case returns: it calls renewSession of its reply and returns an empty map for
// `renew: true` (HY-72.4), raises the ORM error of its `throw` (HY-107), and returns its stated data otherwise.
function loaded(spec: Map<string, unknown>, name: string, reply: Reply): Map<string, unknown> {
  if (spec.get('renew') === true) {
    reply.renewSession();
    return new Map();
  }
  if (spec.has('throw')) throw new OrmError(raisedCode(spec.get('throw'), `the loader ${name}`));
  return new Map(spec);
}

// Returns the handlers of an application for one case: each declared loader returns its stated data, renews the session
// or raises its ORM error, stops with NotFound when its data holds `stop: NotFound` and embeds its data when the
// application lists it; each declared action renews the session when it states so and then raises its ORM error or
// returns its stated page or redirect; the shared handler returns the shared data of the case. Only a declared loader
// or action is registered, as in PHP and Python, so a route region without a loader has none (HY-75.7), and every call
// is recorded in order (HY-124).
function handlersOf(application: Application, shared: Map<string, unknown> | null, calls: string[]): Handlers<Record<string, never>> {
  const routes: Record<string, RouteHandlers<Record<string, never>>> = {};
  for (const route of application.routes) {
    const handler: RouteHandlers<Record<string, never>> = {};
    const spec = application.loaders.get(route.name);
    if (spec !== undefined) {
      const embeds = application.embedData.includes(route.name);
      handler.load = ({ reply }) => {
        if (embeds) reply.embedData();
        if (spec.has('stop')) {
          if (spec.get('stop') !== 'NotFound') throw new Error(`loader ${route.name} stops with a value other than NotFound`);
          throw new NotFound();
        }
        return loaded(spec, route.name, reply);
      };
    }
    const regions: NonNullable<RouteHandlers<Record<string, never>>['regions']> = {};
    for (const region of route.regions) {
      const regionSpec = application.loaders.get(region);
      if (regionSpec !== undefined) regions[region] = ({ reply }) => loaded(regionSpec, region, reply);
    }
    if (Object.keys(regions).length > 0) handler.regions = regions;
    const action = application.actions.get(route.name);
    if (action !== undefined) {
      handler.post = ({ reply }) => {
        calls.push(`action:${route.name}`);
        if (action.renew) reply.renewSession();
        if (action.raises !== null) throw new OrmError(action.raises);
        return action.redirect === null ? Result.page(action.page, action.data) : Result.redirect(action.redirect);
      };
    }
    routes[route.name] = handler;
  }
  if (shared === null) return { routes };
  return {
    shared: () => {
      calls.push('shared');
      return new Map(shared);
    },
    routes,
  };
}

// Returns a string field of a case, and fails for any other value.
function stringField(reader: CaseReader, name: string): string {
  const value = reader.input(name);
  if (typeof value !== 'string') throw new Error(`the case field ${name} is not a string`);
  return value;
}

// Returns a field of a case that is a list of strings, and fails for any other value.
function stringList(reader: CaseReader, name: string): string[] {
  const value = reader.input(name);
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) throw new Error(`the case field ${name} is not a list of strings`);
  return value;
}

// Returns a decoded map of a case as the host values that a handler returns (hostValue), and fails for any other value:
// the server, not the step, checks that the values belong to the data model, as in PHP and Python (HY-44).
function hostMap(value: unknown, what: string): Map<string, unknown> {
  return new Map([...mapIn(value, what)].map(([key, item]) => [key, hostValue(item)]));
}

// Returns a decoded value that is a map, and fails for any other value.
function mapOf(value: unknown, name: string): Map<string, Value> {
  if (!(value instanceof Map) || !JsonCodec.inDataModel(value)) throw new Error(`${name} is not a map of the data model`);
  return value;
}


// Returns a field of a case that maps names to strings, and fails for any other value.
function textMap(reader: CaseReader, name: string): Map<string, string> {
  const value = reader.input(name);
  if (!(value instanceof Map)) throw new Error(`the case field ${name} is not a map`);
  const texts = new Map<string, string>();
  for (const [key, item] of value) {
    if (typeof key !== 'string' || typeof item !== 'string') throw new Error(`the case field ${name} holds a value that is not a string`);
    texts.set(key, item);
  }
  return texts;
}

// Returns the form body of a case: its fields, with `_csrf` when the case sends a token (HY-24), or undefined for a case
// that sends neither.
function bodyOf(form: Map<string, string> | undefined, token: string | null): string | undefined {
  if (form === undefined && token === null) return undefined;
  const fields: Record<string, string> = form === undefined ? {} : Object.fromEntries(form);
  if (token !== null) fields._csrf = token;
  return new URLSearchParams(fields).toString();
}

export const steps = {
  withContext(reader: CaseReader): void {
    const shared = new Map<string, Value>(stringList(reader, 'shared').map((name) => [name, name]));
    let keys: string[] | null = null;
    let context: Value | null = null;
    let fails = false;
    try {
      const placed = Context.withContext(shared, new Map<string, Value>([['name', 'Board']]));
      keys = [...placed.keys()];
      context = placed.get('context') ?? null;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('already holds the member context')) throw error;
      fails = true;
    }
    reader.compare('keys', keys);
    reader.compare('context', context);
    reader.compare('fails', fails);
  },
  contexts(reader: CaseReader): void {
    const build = stringField(reader, 'build');
    const text = Context.text(mapOf(JsonCodec.decode(stringField(reader, 'context')), 'context'));
    reader.compare('context', text);
    reader.compare('text', `{"build":"${build}","context":${text}}`);
    reader.compare('hash', Context.hash(build, text));
    if (reader.has('reorderedText')) {
      const reordered = mapOf(JsonCodec.decode(stringField(reader, 'reorderedText')), 'reorderedText');
      reader.compare('reorderedHash', Context.hash(build, Context.text(mapOf(reordered.get('context'), 'the member context of reorderedText'))));
    }
  },

  // Opens the application of a case with its shared data and its context, sends its request and compares the response,
  // the failure that the response hook received (HY-60), the context calls and the shared data.
  async cases(reader: CaseReader): Promise<void> {
    const name = stringField(reader, 'application');
    const applications = reader.input('applications');
    if (!(applications instanceof Map) || !applications.has(name)) throw new Error(`the contract has no application ${name}`);
    const application = applicationOf(applications.get(name), name);
    const dir = join(PROGRAMS, name);
    // Absent shared data declares no shared handler; present shared data must be a map.
    const shared = reader.has('shared') ? hostMap(reader.input('shared'), 'the shared data of the case') : application.shared;
    const contextText = reader.has('context') ? stringField(reader, 'context') : application.context;
    const calls: string[] = [];
    const selections: unknown[] = [];
    let failure: string | null = null;
    const handlers = handlersOf(application, shared, calls);
    // The handler returns the decoded text as it is, also a value that is not a map, so that the server checks it
    // (HY-124).
    let contextHandler: ContextHandler | null = null;
    if (contextText !== null) {
      // @ts-expect-error -- a case hands the server a value that is not a Map, which the type of the handler excludes
      contextHandler = (selection) => {
        calls.push('context');
        selections.push(selection);
        return hostValue(JsonCodec.decode(contextText));
      };
    }
    const app = await App.open<Record<string, never>>({
      manifest: join(dir, 'manifest.json'),
      build: join(dir, 'build.json'),
      templates: { index: join(dir, 'node', 'templates.index.json'), root: join(dir, 'node') },
      handlers,
      timezone: '+09:00',
      log: () => {},
      onResponse: (_request, _response, _elapsed, _reply, received) => {
        failure = received;
      },
      ...(contextHandler === null ? {} : { context: contextHandler }),
    });
    const store = new ArraySession();
    const csrfInput = reader.has('request.csrf') ? reader.input('request.csrf') : false;
    if (typeof csrfInput !== 'boolean') throw new Error('the case field request.csrf is not a boolean');
    const csrf = csrfInput;
    let token: string | null = null;
    if (csrf) {
      // A first response of the same session makes its token (HY-24); the case masks the token that the session holds.
      // Its calls are not the case's calls.
      await app.handle(requestOf({ method: 'GET', target: '/', headers: { Accept: 'text/html' } }), store);
      const held = store.get('_hyper_csrf');
      if (typeof held !== 'string') throw new Error('the first response of the session created no token');
      token = Csrf.masked(held);
      calls.length = 0;
      selections.length = 0;
    }
    const form = reader.has('request.form') ? textMap(reader, 'request.form') : undefined;
    const body = bodyOf(form, token);
    const headers = Object.fromEntries(textMap(reader, 'request.headers'));
    const response = await app.handle(
      requestOf({
        method: stringField(reader, 'request.method'),
        target: stringField(reader, 'request.target'),
        headers,
        body: body === undefined ? undefined : Buffer.from(body, 'latin1'),
      }),
      store,
    );

    reader.compare('status', response.status);
    if (reader.has('headers')) reader.compare('headers', response.headers);
    reader.compare('absentHeaders', response.headers);
    reader.compare('body', response.body);
    reader.compare('bodyContains', response.body);
    reader.compare('bodyNotContains', response.body);
    reader.compare('failure', failure);
    if (reader.has('keys') || reader.has('sharedKeys')) {
      const json = record(parsed(response.body));
      reader.compare('keys', json);
      reader.compare('sharedKeys', record(json.shared));
    }
    if (reader.has('regionKeys')) reader.compare('regionKeys', record(record(parsed(response.body)).regions));
    if (reader.has('tokenOfSession')) {
      // HY-72.3: the masked token of the body is a masked value of the token that the session holds after the request.
      const masked = record(record(parsed(response.body)).shared).csrf;
      const held = store.get('_hyper_csrf');
      if (typeof held !== 'string') throw new Error('the session holds no token after the request');
      reader.compare('tokenOfSession', typeof masked === 'string' && Csrf.verify(held, masked));
    }
    if (reader.has('renewals')) reader.compare('renewals', store.renewals());
    reader.compare('contextCalls', calls.filter((call) => call === 'context').length);
    reader.compare('firstCalls', calls);
    reader.compare('selection', selections);
  },
};
