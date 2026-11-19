// The fixture application of the PHP server tests, served by the Node server.
import type { Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Db, Query, Schema } from '@polyspec/orm';
import { App, ArraySession, Choice, ClientRendering, Request, Result, type AppOptions, type Container, type Handlers, type RequestInit, type Response, type RouteHandlers } from '../src/index.js';
import type { SessionStore } from '../src/session/session-store.js';
import { Cookies } from '../src/http/cookies.js';

export const FIXTURES = fileURLToPath(new URL('../../php/tests/fixtures/', import.meta.url));
// The server program of the fixtures, which `make node-fixtures` builds with scripts/fixture-program.mts and the build
// id of the fixtures (HY-48.19, HY-125.21).
export const PROGRAM = fileURLToPath(new URL('./build/program', import.meta.url));
export const JSON_REGION = { Accept: 'application/vnd.hyper+json', 'HX-Request': 'true' };

export interface Counter {
  count: number;
  actions: number;
}

export interface Services {
  counter: Counter;
}

// The route region `rows` of `list` with the given items, and the load of `item`, which both handler sets hold.
export function listAndItem(items: (services: Container<Services>) => string[]): { list: RouteHandlers<Services>; item: RouteHandlers<Services> } {
  return {
    list: { regions: { rows: ({ services }) => ({ items: items(services), open: false, mode: 'a', view: 'x', filter: { a: 1 }, tags: [] }) } },
    item: { load: ({ request }) => ({ id: request.param('id') }) },
  };
}

// The handlers of the fixture application for the tests of one language: the region `side`, the loads of `home` and
// `item`, the action of `add` and the route region `rows` of `list`.
export function handlers(): Handlers<Services> {
  return {
    regions: {
      side: ({ request, services }) => ({ count: services.get('counter').count, note: request.flash('note') }),
    },
    routes: {
      home: { load: ({ services }) => ({ name: `n${services.get('counter').count}` }) },
      add: {
        post: ({ services }) => {
          const counter = services.get('counter');
          counter.actions++;
          counter.count++;
          return Result.redirect('/').flash('note', 'added').changed('count');
        },
      },
      ...listAndItem((services) => ['a<', `b${services.get('counter').count}`]),
    },
  };
}

// A fixture application with one session and one counter, as the PHP AppTest sets them up.
// The errors of the orm package that a case throws, by `<class>:<kind>`, which ormErrors gets by real calls (HY-107.7).
let ormCaught: ReadonlyMap<string, Error> | null = null;

/**
 * Gets the errors of the orm package that the cases throw by real calls on a SQLite file of packages/php/tests/fixtures/orm-errors.json
 * in a temporary directory, as the generated tests of orm 0.0.34 make them: an update with an expected revision that the
 * row does not hold gives `revision_changed` (generated.test.mjs:6376, Query.update a_changed_revision), an update with
 * require_match of a key that no row holds gives `no_rows` (:6480, require_match_of_a_row_that_no_key_holds), and a
 * connection to a file in a missing directory gives the OrmStoreError `driver` (:917, a_database_in_a_missing_directory).
 * The database is closed and the directory removed before it returns (HR-87); the errors are kept for the process.
 */
export async function ormErrors(): Promise<void> {
  if (ormCaught !== null) return;
  const fixture = ormFixtureOf(JSON.parse(readFileSync(join(FIXTURES, 'orm-errors.json'), 'utf8')));
  const directory = mkdtempSync(join(tmpdir(), 'hyper-orm-errors-'));
  const caught = new Map<string, Error>();
  try {
    const schema = Schema.load(fixture.manifest, '', fixture.manifestHash);
    const db = await Db.connectSchema(`sqlite://${join(directory, 'shop.db')}`, schema, 1, {});
    try {
      for (const step of fixture.steps) await db.execute(step, []);
      const changed = Query.new(schema, fixture.entity);
      changed.connect(db);
      changed.set('id', fixture.revisionChanged.key);
      changed.set('qty', fixture.revisionChanged.qty);
      changed.expectRevision(fixture.revisionChanged.revisionColumn, fixture.revisionChanged.revision);
      caught.set('OrmValueError:revision_changed', await rejected(() => changed.update()));
      const missing = Query.new(schema, fixture.entity);
      missing.connect(db);
      missing.set('id', fixture.noRows.key);
      missing.set('qty', fixture.noRows.qty);
      missing.requireMatch();
      caught.set('OrmValueError:no_rows', await rejected(() => missing.update()));
    } finally {
      await db.close();
    }
    caught.set('OrmStoreError:driver', await rejected(() => Db.connect(`sqlite://${join(directory, fixture.driver)}`, 1, {})));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  for (const [key, error] of caught) {
    const [name, kind] = key.split(':');
    if (error.name !== name || Reflect.get(error, 'kind') !== kind) throw new Error(`the orm call for ${key} raised ${error.name} ${String(Reflect.get(error, 'kind'))}: ${error.message}`);
  }
  ormCaught = caught;
}

interface OrmFixture {
  manifest: string;
  manifestHash: string;
  entity: string;
  steps: string[];
  revisionChanged: { key: number; qty: number; revisionColumn: string; revision: number };
  noRows: { key: number; qty: number };
  driver: string;
}

// The fixture of ormErrors, and fails for a file that does not hold its members.
function ormFixtureOf(value: unknown): OrmFixture {
  const isRecord = (item: unknown): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item);
  const isNumber = (item: unknown): item is number => typeof item === 'number';
  if (!isRecord(value) || !isRecord(value.revisionChanged) || !isRecord(value.noRows) || !Array.isArray(value.steps)) throw new Error('packages/php/tests/fixtures/orm-errors.json is no orm fixture');
  const { manifest, manifestHash, entity, driver, steps, revisionChanged, noRows } = value;
  const { key, qty, revisionColumn, revision } = revisionChanged;
  if (typeof manifest !== 'string' || typeof manifestHash !== 'string' || typeof entity !== 'string' || typeof driver !== 'string' || typeof revisionColumn !== 'string') throw new Error('packages/php/tests/fixtures/orm-errors.json holds a text that is no string');
  const texts = steps.filter((step: unknown): step is string => typeof step === 'string');
  if (texts.length !== steps.length || !isNumber(key) || !isNumber(qty) || !isNumber(revision) || !isNumber(noRows.key) || !isNumber(noRows.qty)) throw new Error('packages/php/tests/fixtures/orm-errors.json holds a step or a number of another type');
  return { manifest, manifestHash, entity, driver, steps: texts, revisionChanged: { key, qty, revisionColumn, revision }, noRows: { key: noRows.key, qty: noRows.qty } };
}

// The error that a call raises; a call that returns fails, since the case needs its error.
async function rejected(call: () => Promise<unknown>): Promise<Error> {
  try {
    await call();
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`an orm call raised ${String(error)}, which is no Error`, { cause: error });
  }
  throw new Error('an orm call that must fail returned');
}

/**
 * The error of the orm package that the `throw` of a case names by its class and its kind (HY-107.7), which ormErrors got
 * before the case was set up.
 */
export function ormError(thrown: unknown, what: string): Error {
  if (!(thrown instanceof Map)) throw new Error(`the throw of ${what} is not a map`);
  const key = `${String(thrown.get('class'))}:${String(thrown.get('kind'))}`;
  if (ormCaught === null) throw new Error(`${what} throws an error of the orm package before ormErrors got them`);
  const error = ormCaught.get(key);
  if (error === undefined) throw new Error(`${what} throws ${key}, which ormErrors does not get`);
  return error;
}

export class Fixture {
  readonly session = new ArraySession();
  readonly counter: Counter = { count: 0, actions: 0 };
  readonly log: string[] = [];

  async app(options: Partial<AppOptions<Services>> = {}): Promise<App<Services>> {
    const app = await App.open<Services>({
      manifest: `${FIXTURES}app.json`,
      program: PROGRAM,
      handlers: handlers(),
      timezone: '+09:00',
      log: (message) => this.log.push(message),
      ...options,
    });
    app.bind('counter', () => this.counter);
    return app;
  }

  async handle(init: { method?: string; target: string; headers?: Record<string, string>; body?: string; https?: boolean }, options: Partial<AppOptions<Services>> = {}, session: SessionStore = this.session): Promise<Response> {
    const headers = init.body === undefined ? init.headers : { 'Content-Type': 'application/x-www-form-urlencoded', ...init.headers };
    const request = requestFrom({ method: init.method ?? 'GET', target: init.target, ...(headers === undefined ? {} : { headers }), ...(init.body === undefined ? {} : { body: Buffer.from(init.body, 'latin1') }), ...(init.https === undefined ? {} : { https: init.https }) });
    return (await this.app(options)).handle(request, session);
  }

  get(target: string, headers: Record<string, string> = {}, basePath = ''): Promise<Response> {
    return this.handle({ target, headers }, { basePath });
  }
}

// The JSON of a page response: its shared data, the data of its regions and its kept values (HY-17).
export function json(response: Response): Record<string, unknown> & { shared: Record<string, unknown>; regions: Record<string, unknown>; kept: Record<string, unknown> } {
  const page = record(parsedBody(response.body));
  return { ...page, shared: record(page.shared), regions: record(page.regions), kept: record(page.kept) };
}

// The request of a case as the PHP and Python steps make it: the method in upper case, the path and the raw query of
// the target, the headers by lower-case names, and the cookies of the one parse of the Cookie header (HY-129).
export function requestFrom(parts: { method: string; target: string; headers?: Record<string, string>; body?: Uint8Array; https?: boolean }): Request {
  const headers = Object.fromEntries(Object.entries(parts.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]));
  const { method, target, body, https = false } = parts;
  const init: RequestInit = { method: method.toUpperCase(), path: Request.targetPath(target), query: Request.targetQuery(target), headers, cookies: Cookies.parse(headers.cookie ?? null), https };
  if (body !== undefined) init.body = body;
  return new Request(init);
}

// Returns the bytes of a text whose characters U+0000 to U+00FF are bytes, and fails for another character, which
// Buffer.from(text, 'latin1') cuts to its low byte.
export function bytesOf(text: string): Buffer {
  if (/[\u0100-\uffff]/.test(text)) throw new Error('the text of the case holds a character above U+00FF');
  return Buffer.from(text, 'latin1');
}

// The value of a JSON text, which a test narrows with record and text.
export function parsedBody(body: string): unknown {
  return JSON.parse(body);
}

// Returns true for a JSON object.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Returns a value that is a JSON object; another value fails the test.
export function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${JSON.stringify(value)} is not an object`);
  return value;
}

// Returns a value that is a string; another value fails the test.
function text(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError(`${JSON.stringify(value)} is not a string`);
  return value;
}

// Returns a value that is a JSON array; another value fails the test.
export function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${JSON.stringify(value)} is not an array`);
  return value;
}

// Returns a value that the test expects to be there; null or undefined fails the test.
export function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new TypeError('the value is missing');
  return value;
}

// Returns the port of a listening server.
export function port(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new TypeError('the server listens on no port');
  return address.port;
}

// The contract of the client rendering (HY-62) and the declaration that its cases run against.
const conformance = record(parsedBody(readFileSync(new URL('../../../contracts/client.json', import.meta.url), 'utf8')));
const BASE_PATH = text(conformance.basePath);
const CHOSEN_HOST = text(conformance.chosenHost);
export const SHELL = `${FIXTURES}shell/index.html`;
// A session token of HY-24; the form carries a masked value of it.
export const TOKEN = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
export const client = (selects: ClientRendering['selects'] = (request) => new Choice(request.header('Host') === CHOSEN_HOST, null)): ClientRendering => new ClientRendering(SHELL, BASE_PATH, selects);
