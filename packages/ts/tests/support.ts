// The fixture application of the PHP server tests, served by the Node server.
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { App, ArraySession, Choice, ClientRendering, Request, Result, type AppOptions, type Container, type Handlers, type RequestInit, type Response, type RouteHandlers } from '../src/index.js';
import type { SessionStore } from '../src/session/session-store.js';
import { Cookies } from '../src/http/cookies.js';

export const FIXTURES = fileURLToPath(new URL('../../php/tests/fixtures/', import.meta.url));
// The template files of the fixtures, which `make hyper-test-node` builds with scripts/build-templates.mts.
const BUILD = fileURLToPath(new URL('./build/', import.meta.url));
export const TEMPLATES = { index: `${BUILD}templates.index.json`, root: BUILD };
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
/** An error shaped like the OrmError of @polyspec/orm, which hyper identifies by its class name and its code (HY-107). */
export class OrmError extends Error {
  public readonly code: string;

  public constructor(code: string) {
    super(`${code}: a failure of the ORM`);
    this.name = 'OrmError';
    this.code = code;
  }
}

export class Fixture {
  readonly session = new ArraySession();
  readonly counter: Counter = { count: 0, actions: 0 };
  readonly log: string[] = [];

  async app(options: Partial<AppOptions<Services>> = {}): Promise<App<Services>> {
    const app = await App.open<Services>({
      manifest: `${FIXTURES}app.json`,
      build: `${FIXTURES}build.json`,
      templates: TEMPLATES,
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

// Converts the Maps of a parsed contract value into plain objects, the shape the manifest file holds.
export function plain(value: unknown): unknown {
  if (value instanceof Map) return Object.fromEntries([...value].map(([key, item]) => [key, plain(item)]));
  if (Array.isArray(value)) return value.map(plain);
  return value;
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
