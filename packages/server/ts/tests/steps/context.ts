// The steps of contracts/context.json (HY-124 to HY-128): the context hashes and the requests that an application with or
// without a context answers. Every expected value comes from the contract.
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Context } from '../../src/context.js';
import { Csrf } from '../../src/csrf.js';
import { JsonCodec, type DecodedValue } from '../../src/json-codec.js';
import { OutsideNumber } from '../../src/outside-number.js';
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

// Returns a decoded value that is a map, and fails for any other value.
function mapOf(value: unknown, name: string): Map<string, Value> {
  if (!(value instanceof Map) || !JsonCodec.inDataModel(value)) throw new Error(`${name} is not a map of the data model`);
  return value;
}

// Returns a decoded JSON value as the host value that a context handler returns: an integer outside ±(2^53 − 1) is a
// bigint, as PHP and Python decode it to their integer, so that the three servers check the same value (HY-44). A number
// with a fraction or an exponent outside that range has no host value of the case and fails.
function hostValue(value: DecodedValue): unknown {
  if (value instanceof OutsideNumber) {
    if (!/^-?(?:0|[1-9][0-9]*)$/u.test(value.literal)) throw new Error(`the case number ${value.literal} is not an integer`);
    return BigInt(value.literal);
  }
  if (Array.isArray(value)) return value.map(hostValue);
  if (value instanceof Map) return new Map([...value].map(([key, item]) => [key, hostValue(item)]));
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
    if (!(applications instanceof Map) || !(applications.get(name) instanceof Map)) throw new Error(`the contract has no application ${name}`);
    const application = plain(applications.get(name)) as Application;
    const dir = join(PROGRAMS, name);
    const sharedInput = reader.has('shared') ? plain(reader.input('shared')) : application.shared;
    if (typeof sharedInput !== 'object' || sharedInput === null || Array.isArray(sharedInput)) throw new Error('the shared data of the case is not a map');
    const shared = Object.fromEntries(Object.entries(sharedInput));
    const contextText = reader.has('context') ? stringField(reader, 'context') : (application.context ?? null);
    const calls: string[] = [];
    const selections: unknown[] = [];
    let failure: string | null = null;
    const handlers = handlersOf(application, shared, calls);
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
      ...(contextText === null
        ? {}
        : {
            context: (selection: unknown) => {
              calls.push('context');
              selections.push(selection);
              // The handler returns the decoded text as it is, also a value that is not a map, so that the server checks
              // it (HY-124).
              // @ts-expect-error -- a case hands the server a value that is not a Map, which the type of the handler excludes
              return hostValue(JsonCodec.decode(contextText));
            },
          }),
    });
    const store = new MemorySessionStore();
    const csrfInput = reader.has('request.csrf') ? reader.input('request.csrf') : false;
    if (typeof csrfInput !== 'boolean') throw new Error('the case field request.csrf is not a boolean');
    const csrf = csrfInput;
    let token: string | null = null;
    if (csrf) {
      // A first response of the same session makes its token (HY-24); the case masks the token that the session holds.
      // Its calls are not the case's calls.
      await app.handle(Request.from({ method: 'GET', target: '/', headers: { Accept: JSON_TYPE } }), store);
      const held = store.get('_hyper_csrf');
      if (typeof held !== 'string') throw new Error('the first response of the session created no token');
      token = Csrf.masked(held);
      calls.length = 0;
      selections.length = 0;
    }
    const form = reader.has('request.form') ? textMap(reader, 'request.form') : undefined;
    const body = bodyOf(form, token);
    const headers = Object.fromEntries(textMap(reader, 'request.headers'));
    const requestHeaders = body === undefined ? headers : { 'Content-Type': 'application/x-www-form-urlencoded', ...headers };
    const response = await app.handle(
      Request.from({
        method: stringField(reader, 'request.method'),
        target: stringField(reader, 'request.target'),
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
    reader.compare('failure', failure);
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
