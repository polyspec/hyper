// The steps of contracts/app.json (HY-3 to HY-131): one request to a declarative page application after the requests
// before it in one session, and the opens that fail. The handlers of an application are lists of steps of a closed
// vocabulary, which the three servers build the same way.
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkManifest, createApplication, decodeResponse, renderDocument, renderParts, type TemplateIndex } from '@polyspec/hyper-client';
import { decodeTemplate } from '@polyspec/template/render';
import type { ContextHandler } from '../../src/app/context.js';
import { Csrf } from '../../src/session/csrf.js';
import { App, ArraySession, BadRequest, Forbidden, NotFound, Redirect, Result, type Action, type AppOptions, type Container, type Handlers, type Loader, type Reply, type Request, type Response, type RouteHandlers } from '../../src/index.js';
import { Session } from '../../src/session/session.js';
import { toValue } from '../../src/data/values.js';
import type { CaseReader } from '../case-reader.js';
import { parsed } from '../case-rules.js';
import { bytesOf, OrmError, parsedBody, record, requestFrom } from '../support.js';
import { listOf, mapOf, textOf } from '../inputs.js';
import { comparesParts } from './parts-cases.js';
import { comparesOpen, failureOf, Recorded, RecordingStore } from './recorded.js';
import { call as replyCall } from './reply.js';
import { callsOf, decoded } from './session-requests.js';

// The applications of the contracts, built once for the three servers by scripts/contract-programs.mts.
const PROGRAMS = fileURLToPath(new URL('../../../../var/contract-programs/', import.meta.url));
const TOKEN_KEY = '_hyper_csrf';
const EMBEDDED = '<script type="application/json" id="hy-data">';

// The services of an application: each is one record of members with integer values.
interface Services {
  counter: Record<string, number>;
  mailer: Record<string, number>;
}

// What a handler receives: the request, the reply of the request and the services.
interface Argument {
  request: Request;
  reply: Reply;
  services: Container<Services>;
}

// What the handlers of an application record: the name of each call when it starts, and the observations.
interface Run {
  calls: string[];
  observed: [string, unknown][];
}

// The response to a request of `before`, with the token that the session held after it.
interface Sent {
  response: Response;
  token: unknown;
}

// An instance of a class of the test tree with one public member, the kind `applicationObject`.
class ApplicationObject {
  readonly id = 1;
}

// Returns a service name of a case, and fails for a name outside the closed set.
function serviceName(value: unknown): keyof Services {
  if (value !== 'counter' && value !== 'mailer') throw new Error(`the case names the unknown service ${String(value)}`);
  return value;
}

// Returns an integer of a case, and fails for any other value.
function integerOf(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`${what} is not an integer`);
  return value;
}

// Returns the value of a kind of the fixture `valueKinds` in this runtime, built anew for each evaluation.
function kindValue(name: string): unknown {
  switch (name) {
    case 'date':
      return new Date('2026-01-01T00:00:00Z');
    case 'applicationObject':
      return new ApplicationObject();
    case 'plainObject':
      return { a: 1 };
    case 'notANumber':
      return Number.NaN;
    case 'largeFloat':
      return 1e20;
    case 'floatTwoTo53':
      return 9007199254740992;
    case 'loneSurrogate':
      return '\ud800';
    case 'function':
      return () => 1;
    default:
      throw new Error(`the kind ${name} has no value in this runtime`);
  }
}

// Returns the value of an expression of the vocabulary for the request of a handler.
function expression(spec: Map<string, unknown>, argument: Argument): unknown {
  const name = (): string => textOf(spec.get('name'), 'the name of an expression');
  const word = textOf(spec.get('$'), 'the word of an expression');
  switch (word) {
    case 'param':
      return argument.request.param(name());
    case 'queryInt':
      return argument.request.queryInt(name(), integerOf(spec.get('default'), 'the default of queryInt'));
    case 'formString':
      return argument.request.formString(name());
    case 'flash':
      return argument.request.flash(name());
    case 'header':
      return argument.request.header(name());
    case 'path':
      return argument.request.path();
    case 'method':
      return argument.request.method;
    case 'selection':
      return argument.request.selection();
    case 'browser':
      return argument.request.browser();
    case 'csrfToken':
      return argument.request.csrfToken();
    case 'service':
      return argument.services.get(serviceName(spec.get('name')))[textOf(spec.get('member'), 'the member of a service')];
    case 'text':
      return listOf(spec.get('parts'), 'the parts of a text')
        .map((part) => {
          const value = evaluated(part, argument);
          if (value === null) return '';
          if (typeof value !== 'string' && typeof value !== 'number') throw new Error('a part of a text is not a text, an integer or null');
          return String(value);
        })
        .join('');
    case 'kind':
      return kindValue(name());
    default:
      throw new Error(`the expression ${word} of the case is unknown`);
  }
}

// Returns a data value of a handler as the host value of this runtime, with its expressions evaluated in document
// order: a JSON object is a Map, and an integer outside ±(2^53 − 1) is a bigint (HY-44).
function evaluated(value: unknown, argument: Argument): unknown {
  if (Array.isArray(value)) return value.map((item: unknown) => evaluated(item, argument));
  if (!(value instanceof Map)) return value;
  const map = mapOf(value, 'a data value of a handler');
  if (map.has('$')) return expression(map, argument);
  return new Map([...map].map(([key, item]) => [key, evaluated(item, argument)]));
}

// Returns the redirect result of a step: its path, its flash values and its changed topics in their order.
function redirectOf(step: Map<string, unknown>, argument: Argument): Result {
  let result = Result.redirect(textOf(step.get('redirect'), 'the path of a redirect'));
  for (const pair of step.has('flashes') ? listOf(step.get('flashes'), 'the flashes of a redirect') : []) {
    const [name, text] = listOf(pair, 'a flash of a redirect');
    result = result.flash(textOf(name, 'the name of a flash'), evaluated(decoded(text), argument));
  }
  for (const topic of step.has('topics') ? listOf(step.get('topics'), 'the topics of a redirect') : []) result = result.changed(textOf(topic, 'a topic'));
  return result;
}

// The words of the steps that end a handler with its result.
const RESULTS = ['return', 'stop', 'throw', 'redirect', 'page'];

// Returns the steps of a handler of a case, and fails for a handler whose last step is no result.
function stepsOf(value: unknown, name: string): Map<string, unknown>[] {
  const steps = listOf(value, `the handler ${name}`).map((step) => mapOf(step, `a step of the handler ${name}`));
  const last = steps.at(-1);
  if (last === undefined || !RESULTS.some((word) => last.has(word))) throw new Error(`the handler ${name} has no result step`);
  return steps;
}

// Performs the steps of a handler in order and returns or throws its result. The name of the handler is recorded when
// its call starts.
function performed(name: string, steps: Map<string, unknown>[], run: Run, argument: Argument): unknown {
  run.calls.push(name);
  for (const step of steps) {
    if (step.has('calls')) {
      for (const [method, args] of callsOf(step.get('calls'))) replyCall(argument.reply, method, args);
    } else if (step.has('observe')) {
      run.observed.push([name, evaluated(step.get('observe'), argument)]);
    } else if (step.has('add')) {
      const [service, member, amount] = listOf(step.get('add'), 'the arguments of add');
      const record = argument.services.get(serviceName(service));
      const key = textOf(member, 'the member of add');
      record[key] = (record[key] ?? 0) + integerOf(amount, 'the amount of add');
    } else if (step.has('warn')) {
      process.emitWarning(textOf(step.get('warn'), 'the message of warn'));
    } else if (step.has('stop')) {
      const kind = step.get('stop');
      if (kind === 'NotFound') throw new NotFound();
      if (kind === 'Forbidden') throw new Forbidden();
      if (kind === 'BadRequest') throw new BadRequest();
      if (kind === 'Redirect') throw new Redirect(redirectOf(step, argument));
      throw new Error(`the stop ${String(kind)} of the case is unknown`);
    } else if (step.has('throw')) {
      const thrown = mapOf(step.get('throw'), 'the throw of a handler');
      if (thrown.get('class') === 'OrmError') throw new OrmError(textOf(thrown.get('code'), 'the code of a throw'));
      if (thrown.get('class') === 'Error') throw new Error(textOf(thrown.get('message'), 'the message of a throw'));
      throw new Error(`the case throws the unknown class ${String(thrown.get('class'))}`);
    } else if (step.has('redirect')) {
      return redirectOf(step, argument);
    } else if (step.has('page')) {
      // @ts-expect-error -- a case gives the status and the data as decoded JSON values, which the result checks
      return Result.page(step.get('page'), step.has('data') ? evaluated(step.get('data'), argument) : new Map());
    } else if (step.has('return')) {
      return evaluated(step.get('return'), argument);
    } else {
      throw new Error(`a step of the handler ${name} is unknown`);
    }
  }
  throw new Error(`the handler ${name} ended without a result`);
}

// Returns a loader of the steps of a case. It returns what the case states, also a value that is no data, so that the
// server checks it (HY-44).
function loader(name: string, value: unknown, run: Run): Loader<Services> {
  const steps = stepsOf(value, name);
  // @ts-expect-error -- a loader of a case returns a decoded value of any type, which the type of a loader excludes
  return (argument) => performed(name, steps, run, argument);
}

// Returns an action of the steps of a case. It returns what the case states, also a value that is no result.
function action(name: string, value: unknown, run: Run): Action<Services> {
  const steps = stepsOf(value, name);
  // @ts-expect-error -- an action of a case returns a decoded value of any type, which the type of an action excludes
  return (argument) => performed(name, steps, run, argument);
}

// Returns the handlers of an application with those of the case merged over them one by one; a handler that the case
// states as null is removed, and a route entry stays an entry, also without a handler.
function merged(base: Map<string, unknown>, over: Map<string, unknown>): Map<string, unknown> {
  // Returns the entries of `first` replaced or followed by those of `second`, without the entries that are null.
  const maps = (first: unknown, second: unknown, what: string): Map<string, unknown> => {
    const result = new Map(first === undefined ? [] : mapOf(first, what));
    for (const [key, item] of second === undefined ? [] : mapOf(second, what)) {
      if (item === null) result.delete(key);
      else result.set(key, item);
    }
    return result;
  };
  const result = new Map<string, unknown>();
  const shared = over.has('shared') ? over.get('shared') : base.get('shared');
  if (shared !== undefined && shared !== null) result.set('shared', shared);
  result.set('regions', maps(base.get('regions'), over.get('regions'), 'the region handlers'));
  const routes = new Map(base.has('routes') ? mapOf(base.get('routes'), 'the route handlers') : []);
  for (const [name, entry] of over.has('routes') ? mapOf(over.get('routes'), 'the route handlers') : []) {
    const before = routes.has(name) ? mapOf(routes.get(name), `the handlers of ${name}`) : new Map<string, unknown>();
    const stated = mapOf(entry, `the handlers of ${name}`);
    const route = maps(new Map([...before].filter(([key]) => key !== 'regions')), new Map([...stated].filter(([key]) => key !== 'regions')), `the handlers of ${name}`);
    if (before.has('regions') || stated.has('regions')) route.set('regions', maps(before.get('regions'), stated.get('regions'), `the region handlers of ${name}`));
    routes.set(name, route);
  }
  result.set('routes', routes);
  return result;
}

// Builds the handlers of the server from the merged handlers of a case. Only a stated handler is registered.
function handlersOf(spec: Map<string, unknown>, run: Run): Handlers<Services> {
  const regions = (value: unknown, what: string): Record<string, Loader<Services>> =>
    Object.fromEntries([...mapOf(value, what)].map(([name, steps]) => [name, loader(`region:${name}`, steps, run)]));
  const routes: Record<string, RouteHandlers<Services>> = {};
  for (const [name, entry] of mapOf(spec.get('routes'), 'the route handlers')) {
    const route = mapOf(entry, `the handlers of ${name}`);
    for (const key of route.keys()) {
      if (key !== 'load' && key !== 'post' && key !== 'regions') throw new Error(`the handler ${key} of the route ${name} is unknown`);
    }
    routes[name] = {
      ...(route.has('load') ? { load: loader(`load:${name}`, route.get('load'), run) } : {}),
      ...(route.has('post') ? { post: action(`action:${name}`, route.get('post'), run) } : {}),
      ...(route.has('regions') ? { regions: regions(route.get('regions'), `the region handlers of ${name}`) } : {}),
    };
  }
  return {
    ...(spec.has('shared') ? { shared: loader('shared', spec.get('shared'), run) } : {}),
    regions: regions(spec.get('regions'), 'the region handlers'),
    routes,
  };
}

// Returns the options of `open` that an application and a case state, by their names; an option that neither states
// is not passed, and another name fails the case. A number is passed as the case states it, also with a fraction.
function optionsOf(application: Map<string, unknown>, reader: CaseReader): Partial<AppOptions<Services>> {
  const stated = new Map([
    ...(application.has('options') ? mapOf(application.get('options'), 'the options of the application') : []),
    ...(reader.has('options') ? mapOf(reader.input('options'), 'the case field options') : []),
  ]);
  const options: Partial<AppOptions<Services>> = {};
  const number = (value: unknown, name: string): number => {
    if (typeof value !== 'number') throw new Error(`the option ${name} is not a number`);
    return value;
  };
  for (const [name, value] of stated) {
    switch (name) {
      case 'basePath':
        options.basePath = textOf(value, 'the option basePath');
        break;
      case 'frameAncestors':
        options.frameAncestors = textOf(value, 'the option frameAncestors');
        break;
      case 'https':
        if (typeof value !== 'boolean') throw new Error('the option https is not a boolean');
        options.https = value;
        break;
      case 'bodyLimit':
        options.bodyLimit = number(value, name);
        break;
      case 'fileLimit':
        options.fileLimit = number(value, name);
        break;
      case 'valueLimit':
        options.valueLimit = number(value, name);
        break;
      case 'partLimit':
        options.partLimit = number(value, name);
        break;
      case 'responseLimit':
        options.responseLimit = number(value, name);
        break;
      case 'formTypes':
        options.formTypes = listOf(value, 'the option formTypes').map((type) => textOf(type, 'a form type'));
        break;
      default:
        throw new Error(`the option ${name} of the case is unknown`);
    }
  }
  return options;
}

// The application of a case as the step opens it: its record, the services that its factories made, and the options of
// `open` without the files of its program.
interface Opening {
  application: Map<string, unknown>;
  run: Run;
  recorded: Recorded;
  made: Map<keyof Services, Record<string, number>>;
  options: Omit<AppOptions<Services>, 'manifest' | 'build' | 'templates'>;
}

// Reads the application of a case and builds the options of its `open`: the merged handlers and options, the time
// zone, the context handler, the response hook and the log of the step.
function openingOf(reader: CaseReader): Opening & { name: string } {
  const name = textOf(reader.input('application'), 'the case field application');
  const applications = mapOf(reader.input('applications'), 'the fixture applications');
  if (!applications.has(name)) throw new Error(`the contract has no application ${name}`);
  const application = mapOf(applications.get(name), `the application ${name}`);
  const run: Run = { calls: [], observed: [] };
  const recorded = new Recorded();
  const base = application.has('handlers') ? mapOf(application.get('handlers'), 'the handlers of the application') : new Map<string, unknown>();
  const over = reader.has('handlers') ? mapOf(reader.input('handlers'), 'the case field handlers') : new Map<string, unknown>();
  const options: Opening['options'] = {
    handlers: handlersOf(merged(base, over), run),
    timezone: application.has('timezone') ? textOf(application.get('timezone'), 'the time zone of the application') : '+09:00',
    log: recorded.log,
    onResponse: recorded.onResponse,
    ...optionsOf(application, reader),
  };
  if (application.has('context')) {
    const text = textOf(application.get('context'), 'the context of the application');
    // @ts-expect-error -- the context handler of a case returns the decoded text as it is, also a value that is no Map
    const context: ContextHandler = () => {
      run.calls.push('context');
      return decoded(text);
    };
    options.context = context;
  }
  return { name, application, run, recorded, made: new Map(), options };
}

// Returns the paths of the program of an application in a directory, as `open` takes them.
function programOf(directory: string): Pick<AppOptions<Services>, 'manifest' | 'build' | 'templates'> {
  return { manifest: join(directory, 'manifest.json'), build: join(directory, 'build.json'), templates: { index: join(directory, 'node', 'templates.index.json'), root: join(directory, 'node') } };
}

// Binds one factory for each service of the application, which returns one record with the stated members.
function bind(app: App<Services>, opening: Opening): void {
  for (const [name, members] of opening.application.has('services') ? mapOf(opening.application.get('services'), 'the services of the application') : []) {
    const service = serviceName(name);
    const stated = [...mapOf(members, `the service ${name}`)].map(([member, value]): [string, number] => [member, integerOf(value, `the member ${member} of the service ${name}`)]);
    app.bind(service, () => {
      const record: Record<string, number> = Object.fromEntries(stated);
      opening.made.set(service, record);
      return record;
    });
  }
}

// Writes every byte of a text of bytes outside `A-Z a-z 0-9 - . _ ~` as `%XX` in upper case.
function percentEncoded(text: string): string {
  return [...bytesOf(text)].map((byte) => (/[A-Za-z0-9\-._~]/u.test(String.fromCharCode(byte)) ? String.fromCharCode(byte) : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)).join('');
}

// Returns the body with every run of exactly 128 lowercase hexadecimal digits that is a masked value of the token
// replaced by the text `masked`; a body of a session without a token stays as it is.
function unmasked(body: string, token: unknown): string {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/u.test(token)) return body;
  return body.replace(/(?<![0-9a-f])[0-9a-f]{128}(?![0-9a-f])/gu, (found) => (Csrf.verify(token, found) ? 'masked' : found));
}

// Returns the JSON object of a text, or null for a text that is no JSON object.
function jsonObject(text: string): Map<string, unknown> | null {
  let value: unknown;
  try {
    value = parsed(text);
  } catch {
    return null;
  }
  return value instanceof Map ? mapOf(value, 'a JSON object') : null;
}

// Returns the string `shared.csrf` of a JSON body, or null for a body without it.
function maskedToken(body: string): string | null {
  const shared = jsonObject(body)?.get('shared');
  const csrf: unknown = shared instanceof Map ? shared.get('csrf') : undefined;
  return typeof csrf === 'string' ? csrf : null;
}

// Returns the value of one header of a response by its name without case, or undefined.
function headerOf(response: Response, name: string): string | string[] | undefined {
  return Object.entries(response.headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
}

// The session of a case and its requests: the store behind its recorder, and the responses of the named requests.
class Requests {
  readonly inner = new ArraySession();
  readonly store = new RecordingStore(this.inner);
  private readonly named = new Map<string, Sent>();
  // The least and the most milliseconds from the start of the last request to its report: from the start to the call
  // of `handle`, and from the start to its return.
  elapsed: [number, number] = [0, 0];
  private readonly app: App<Services>;

  constructor(app: App<Services>) {
    this.app = app;
  }

  // Returns the token that the session holds, which the session unit makes for a session without one (HY-24.1).
  private token(): string {
    return new Session(this.inner).csrfToken();
  }

  // Returns the response to a named request of `before` with the token that the session held after it.
  sent(name: string): Sent {
    const sent = this.named.get(name);
    if (sent === undefined) throw new Error(`the case has no request ${name} before this one`);
    return sent;
  }

  // Returns a text of a request: a string, a reference, or a list of both joined in their order.
  private text(value: unknown): string {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map((part: unknown) => this.text(part)).join('');
    const reference = mapOf(value, 'a text of a request');
    if (reference.has('token')) {
      const kind = reference.get('token');
      if (kind === 'masked') return Csrf.masked(this.token());
      if (kind === 'session') return this.token();
      throw new Error(`the token reference ${String(kind)} of the case is unknown`);
    }
    if (reference.has('repeat')) return textOf(reference.get('repeat'), 'the text of a repeat').repeat(integerOf(reference.get('times'), 'the times of a repeat'));
    if (!reference.has('of')) throw new Error('a reference of the case is unknown');
    const name = textOf(reference.get('of'), 'the request of a reference');
    const { response } = this.sent(name);
    if (reference.has('header')) {
      const header = headerOf(response, textOf(reference.get('header'), 'the header of a reference'));
      if (typeof header !== 'string') throw new Error(`the response to ${name} has no single header ${String(reference.get('header'))}`);
      return header;
    }
    if (reference.has('json')) {
      let value_: unknown = jsonObject(response.body);
      for (const key of listOf(reference.get('json'), 'the path of a reference')) value_ = value_ instanceof Map ? value_.get(key) : undefined;
      return textOf(value_, `the value at the path of the response to ${name}`);
    }
    if (reference.has('setCookie')) {
      const cookie = textOf(reference.get('setCookie'), 'the cookie of a reference');
      const lines = headerOf(response, 'Set-Cookie') ?? [];
      const line = (Array.isArray(lines) ? lines : [lines]).find((item) => item.startsWith(`${cookie}=`));
      if (line === undefined) throw new Error(`the response to ${name} sets no cookie ${cookie}`);
      return line.slice(cookie.length + 1).split(';', 1)[0] ?? '';
    }
    throw new Error('a reference of the case is unknown');
  }

  // Builds one request of the form of the case file and returns the function that sends it. The step adds no header
  // but `Cookie`, which it writes from `cookies`, and gives `handle` a start only for `startedBefore`. The token that a
  // reference or `csrf` needs is made here, before the request is sent.
  built(request: Map<string, unknown>): () => Promise<Response> {
    const headers: Record<string, string> = {};
    for (const [name, value] of mapOf(request.get('headers'), 'the headers of a request')) headers[name] = this.text(value);
    if (request.has('cookies')) {
      headers.Cookie = [...mapOf(request.get('cookies'), 'the cookies of a request')].map(([name, value]) => `${name}=${percentEncoded(this.text(value))}`).join('; ');
    }
    let body: Buffer | undefined;
    const csrf: unknown = request.has('csrf') ? request.get('csrf') : false;
    if (request.has('form')) {
      if (request.has('body')) throw new Error('a request of the case states a form and a body');
      const pairs = [...mapOf(request.get('form'), 'the form of a request')].map(([name, value]): [string, string] => [name, this.text(value)]);
      if (csrf === true) pairs.push(['_csrf', Csrf.masked(this.token())]);
      else if (csrf === 'token') pairs.push(['_csrf', this.token()]);
      else if (csrf !== false) throw new Error('the csrf of a request is not true, false or the text token');
      body = Buffer.from(pairs.map(([name, value]) => `${percentEncoded(name)}=${percentEncoded(value)}`).join('&'), 'latin1');
    } else {
      if (csrf !== false) throw new Error('the csrf of a request needs a form');
      if (request.has('body')) body = bytesOf(this.text(request.get('body')));
    }
    const host = requestFrom({
      method: textOf(request.get('method'), 'the method of a request'),
      target: this.text(request.get('target')),
      headers,
      ...(body === undefined ? {} : { body }),
      https: request.has('https') && request.get('https') === true,
    });
    const before = request.has('startedBefore') ? integerOf(request.get('startedBefore'), 'the startedBefore of a request') : null;
    return async () => {
      // The clock of `handle`, read just before its call and just after its return (HY-60.5).
      const called = performance.now();
      const start = before === null ? called : called - before;
      const response = await (before === null ? this.app.handle(host, this.store) : this.app.handle(host, this.store, start));
      this.elapsed = [called - start, performance.now() - start];
      return response;
    };
  }

  // Sends the requests of `before` in order, requires the status that an item states, and keeps the response of each
  // named one.
  async before(items: unknown[]): Promise<void> {
    for (const [index, item] of items.entries()) {
      const request = mapOf(item, 'a request of before');
      const response = await this.built(request)();
      const name = request.has('name') ? textOf(request.get('name'), 'the name of a request of before') : null;
      if (request.has('status') && request.get('status') !== response.status) throw new Error(`the request ${name ?? String(index)} of before answered ${response.status}`);
      if (name !== null) this.named.set(name, { response, token: this.inner.get(TOKEN_KEY) });
    }
  }
}

// Returns the word of a value that a handler read as `browser()`: `none` for null, `current` for the digest of the
// token that the session holds after the request, `previous` for the digest of another token that it held when the
// request was sent, and `other` for every other value.
function browserWord(value: unknown, after: unknown, before: unknown): string {
  const digest = (token: unknown): string | null =>
    typeof token === 'string' && /^[0-9a-f]{64}$/u.test(token) ? createHash('sha256').update(Buffer.from(token, 'hex')).digest('hex') : null;
  if (value === null) return 'none';
  if (digest(after) !== null && value === digest(after)) return 'current';
  if (digest(before) !== null && before !== after && value === digest(before)) return 'previous';
  return 'other';
}

// Emits a warning of the runtime outside of every request and returns true when it is delivered and no error is raised
// (HY-74.4).
async function warnedOutside(): Promise<boolean> {
  let deliver: (message: string) => void = () => {};
  const delivered = new Promise<string>((resolve) => {
    deliver = resolve;
  });
  const listener = (warning: Error): void => deliver(warning.message);
  process.once('warning', listener);
  try {
    process.emitWarning('outside');
  } catch (error) {
    process.off('warning', listener);
    if (!(error instanceof Error)) throw error;
    return false;
  }
  return (await delivered) === 'outside';
}

// Returns how many times a text holds another, counted without overlap from the left.
function occurrences(text: string, part: string): number {
  if (part === '') throw new Error('a text of counted is empty');
  return text.split(part).length - 1;
}

export const steps = {
  async cases(reader: CaseReader): Promise<void> {
    reader.input('valueKinds');
    const opening = openingOf(reader);
    const { run, recorded } = opening;
    const app = await App.open<Services>({ ...programOf(join(PROGRAMS, opening.name)), ...opening.options });
    bind(app, opening);
    const requests = new Requests(app);
    for (const [key, value] of reader.has('stored') ? mapOf(reader.input('stored'), 'the case field stored') : []) requests.inner.set(key, value);
    await requests.before(reader.has('before') ? listOf(reader.input('before'), 'the case field before') : []);
    // The calls, the observations, the reports and the log of the requests before are discarded; the state stays.
    const request = mapOf(reader.input('request'), 'the case field request');
    run.calls.length = 0;
    run.observed.length = 0;
    recorded.clear();
    requests.store.calls.length = 0;
    // The token just before the request is sent, after the token of `csrf` was made.
    const send = requests.built(request);
    const tokenBefore = requests.inner.get(TOKEN_KEY);
    const response = await send();
    const token = requests.inner.get(TOKEN_KEY);
    const body = response.body;
    const plain = unmasked(body, token);

    reader.compare('status', response.status);
    reader.compare('headers', response.headers);
    reader.compare('allHeaders', response.headers);
    reader.compare('absentHeaders', response.headers);
    reader.compare('body', body);
    reader.compare('bodyContains', body);
    reader.compare('bodyNotContains', body);
    reader.compare('unmaskedBody', plain);
    if (reader.has('members')) {
      const members = jsonObject(plain);
      if (members === null) throw new Error('the body of the response is no JSON object');
      reader.compare('members', members);
    }
    if (reader.has('embedded')) {
      const start = plain.indexOf(EMBEDDED);
      const end = plain.indexOf('</script>', start);
      const embedded = start < 0 || end < 0 ? null : jsonObject(plain.slice(start + EMBEDDED.length, end));
      if (embedded === null) throw new Error('the document holds no element hy-data with a JSON object');
      reader.compare('embedded', embedded);
    }
    if (reader.has('bodyCount')) reader.compare('bodyCount', listOf(reader.input('counted'), 'the case field counted').map((part) => occurrences(body, textOf(part, 'a text of counted'))));
    if (reader.has('keys') || reader.has('sharedKeys') || reader.has('regionKeys')) {
      const json = jsonObject(body);
      if (json === null) throw new Error('the body of the response is no JSON object');
      reader.compare('keys', json);
      if (reader.has('sharedKeys')) reader.compare('sharedKeys', mapOf(json.get('shared'), 'the member shared of the response'));
      if (reader.has('regionKeys')) reader.compare('regionKeys', mapOf(json.get('regions'), 'the member regions of the response'));
    }
    const tag = headerOf(response, 'ETag');
    if (reader.has('tagOfBody')) {
      const masked = maskedToken(body);
      const tagged = masked === null || typeof token !== 'string' ? body : body.replaceAll(masked, token);
      reader.compare('tagOfBody', tag === `W/"${createHash('sha256').update(tagged).digest('hex').slice(0, 32)}"`);
    }
    if (reader.has('sameAsEarlier')) {
      const earlier = requests.sent(textOf(reader.input('earlier'), 'the case field earlier'));
      const earlierTag = headerOf(earlier.response, 'ETag');
      const mask = maskedToken(body);
      reader.compare('sameAsEarlier', {
        tag: typeof tag === 'string' && tag === earlierTag,
        mask: mask !== null && mask === maskedToken(earlier.response.body),
        body: plain === unmasked(earlier.response.body, earlier.token),
      });
    }
    reader.compare('firstCalls', run.calls);
    reader.compare('handlerCalls', run.calls);
    reader.compare('actions', run.calls.filter((name) => name.startsWith('action:')).length);
    // A value that is a masked value of the token that the session holds after the request is written `masked`.
    reader.compare('observed', run.observed.map(([name, value]): [string, unknown] => [name, typeof value === 'string' && /^[0-9a-f]{128}$/u.test(value) ? unmasked(value, token) : value]));
    if (reader.has('browsers')) reader.compare('browsers', run.observed.map(([, value]) => browserWord(value, token, tokenBefore)));
    if (reader.has('serviceValues')) {
      const names = opening.application.has('services') ? [...mapOf(opening.application.get('services'), 'the services of the application').keys()] : [];
      reader.compare('serviceValues', Object.fromEntries(names.map((name) => [name, opening.made.get(serviceName(name)) ?? null])));
    }
    recorded.compare(reader, requests.store);
    if (reader.has('failure')) reader.compare('failure', recorded.last().failure);
    if (reader.has('failureReported')) reader.compare('failureReported', recorded.last().failure !== null);
    if (reader.has('failureLogged')) {
      const { failure } = recorded.last();
      reader.compare('failureLogged', failure !== null && recorded.logged.includes(`hyper: ${failure}`));
    }
    if (reader.has('elapsedFromStart')) {
      const { elapsed } = recorded.last();
      const [least, most] = requests.elapsed;
      reader.compare('elapsedFromStart', typeof elapsed === 'number' && elapsed >= least && elapsed <= most);
    }
    // The keys of the session unit, each with the value that the store holds after the request, or null.
    reader.compare('storedAfter', Object.fromEntries([TOKEN_KEY, '_hyper_flash', '_hyper_keep'].map((key) => [key, requests.inner.get(key) ?? null])));
    reader.compare('renewals', requests.store.calls.filter((name) => name === 'renew').length);
    if (reader.has('tokenOfSession')) {
      const masked = maskedToken(body);
      reader.compare('tokenOfSession', masked !== null && typeof token === 'string' && Csrf.verify(token, masked));
    }
    reader.compare('tokenRenewed', token !== tokenBefore);
    reader.compare('tokenForm', typeof token === 'string' && /^[0-9a-f]{64}$/u.test(token));
    reader.compare('tokenInBody', typeof token === 'string' && body.includes(token));
    reader.compare('session', token !== undefined);
    if (reader.has('restored')) reader.compare('restored', await warnedOutside());
  },

  // Renders the title and each region of the case alone with the browser code, as the Node server renders (HY-54.3),
  // and compares them with their places in the document of the same data and in the page region (HY-13).
  async parts(reader: CaseReader): Promise<void> {
    const name = textOf(reader.input('application'), 'the case field application');
    const applications = mapOf(reader.input('applications'), 'the fixture applications');
    if (!applications.has(name)) throw new Error(`the contract has no application ${name}`);
    const stated = mapOf(applications.get(name), `the application ${name}`);
    const program = programOf(join(PROGRAMS, name));
    const manifest = checkManifest(parsedBody(readFileSync(program.manifest, 'utf8')));
    const index: TemplateIndex = Object.fromEntries(
      Object.entries(record(parsedBody(readFileSync(program.templates.index, 'utf8')))).map(([template, entry]) => [template, { url: textOf(record(entry).url, `the url of the template ${template}`) }]),
    );
    const application = createApplication(manifest, index, async (url) => Promise.resolve(decodeTemplate(parsedBody(readFileSync(join(program.templates.root, url), 'utf8')))));
    await application.templates.ensure(Object.keys(index));
    const routeName = textOf(reader.input('route'), 'the case field route');
    const route = manifest.routes.find((item) => item.name === routeName);
    if (route === undefined) throw new Error(`the application ${name} has no route ${routeName}`);
    if (route.path.includes('{')) throw new Error(`the path of the route ${routeName} has a parameter`);
    const regions = mapOf(reader.input('regions'), 'the case field regions');
    const value = toValue(new Map<string, unknown>([
      ['env', new Map([['timezone', stated.has('timezone') ? textOf(stated.get('timezone'), 'the time zone of the application') : '+09:00']])],
      ['route', routeName],
      ['params', new Map()],
      ['build', textOf(stated.get('build'), 'the build of the application')],
      ['shared', mapOf(reader.input('shared'), 'the case field shared')],
      ['regions', regions],
      ['kept', new Map()],
    ]));
    const rendered = renderParts(application, decodeResponse(application, value, route.path));
    const document = renderDocument(application, decodeResponse(application, value, route.path), { embed: false });
    comparesParts(reader, rendered, document, manifest, route, regions);
  },

  // Opens the application of the case from a copy of its program whose files the case changes, and compares the error
  // of the open and its message.
  async opens(reader: CaseReader): Promise<void> {
    const opening = openingOf(reader);
    const directory = mkdtempSync(join(tmpdir(), 'hyper-app-'));
    let failure: unknown = null;
    try {
      const program = programOf(directory);
      cpSync(join(PROGRAMS, opening.name, 'manifest.json'), program.manifest);
      cpSync(join(PROGRAMS, opening.name, 'build.json'), program.build);
      cpSync(join(PROGRAMS, opening.name, 'node'), program.templates.root, { recursive: true });
      const paths: Record<string, string> = { manifest: program.manifest, 'build.json': program.build, templateIndex: program.templates.index };
      for (const [name, content] of reader.has('files') ? mapOf(reader.input('files'), 'the case field files') : []) {
        const path = Object.hasOwn(paths, name) ? paths[name] : undefined;
        if (path === undefined) throw new Error(`the Node server has no file ${name}`);
        if (content === null) unlinkSync(path);
        else writeFileSync(path, bytesOf(textOf(content, `the file ${name}`)));
      }
      failure = await failureOf(App.open<Services>({ ...program, ...opening.options }));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
    comparesOpen(reader, failure);
  },
};
