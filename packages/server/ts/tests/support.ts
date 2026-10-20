// The fixture application of the PHP server tests, served by the Node server.
import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { Router } from '@polyspec/hyper-client';
import { verifyToken } from '../src/csrf.js';
import { App, BadRequest, Forbidden, MemorySessionStore, NotFound, Redirect, Request, Result, type AppOptions, type ClientRendering, type Handlers, type Response } from '../src/index.js';

export const FIXTURES = fileURLToPath(new URL('../../php/tests/fixtures/', import.meta.url));
// The template files of the fixtures, which `make hyper-test-node` builds with scripts/build-templates.mts.
const BUILD = fileURLToPath(new URL('./build/', import.meta.url));
export const TEMPLATES = { index: `${BUILD}templates.index.json`, root: BUILD };
export const JSON_REGION = { Accept: 'application/json', 'HX-Request': 'true' };

export interface Counter {
  count: number;
  actions: number;
}

export interface Services {
  counter: Counter;
}

export function handlers(): Handlers<Services> {
  return {
    regions: {
      side: ({ request, services }) => ({ count: services.get('counter').count, note: request.flash('note') }),
    },
    routes: {
      home: { load: ({ services }) => ({ name: `n${services.get('counter').count}` }) },
      add: {
        post: ({ request, reply, services }) => {
          const counter = services.get('counter');
          counter.actions++;
          if (request.formString('name') === 'closed') {
            reply.note('refusal', 'action').note('kind', 'closed').note('refusal', 'closed');
            throw new Forbidden();
          }
          if (request.formString('name') === 'unreadable') throw new BadRequest();
          if (request.formString('name') === 'taken') return Result.page(409, { name: 'taken', error: 'conflict' });
          if (request.formString('name') === 'preview') return Result.page(200, { name: 'preview' });
          if (request.formString('name') === 'in-place') {
            reply.status(403);
            return Result.page(200, { name: 'in-place' });
          }
          if (request.formString('name') === 'in-place-refused') {
            reply.status(403);
            return Result.invalid({ name: 'in-place-refused', error: 'empty' });
          }
          if (request.formString('name') === '') return Result.invalid({ name: '', error: 'empty' });
          if (request.formString('name') === 'sign-in') {
            reply.renewSession();
            return Result.redirect('/').flash('note', 'renewed');
          }
          if (request.formString('name') === 'sign-in-page') {
            reply.renewSession();
            return Result.page(200, { name: 'renewed' });
          }
          counter.count++;
          return Result.redirect('/').flash('note', 'added').changed('count');
        },
      },
      list: {
        regions: {
          rows: ({ request, reply, services }) => {
            // HY-92: the query embed=1 makes the document embed its data.
            if (request.queryInt('embed', 0) === 1) reply.embedData();
            return { items: ['a<', `b${services.get('counter').count}`], open: false, mode: 'a', view: 'x', filter: { a: 1 }, tags: [] };
          },
        },
      },
      item: {
        load: async ({ request, reply }) => {
          switch (request.param('id')) {
            case 'member':
              reply.cookie('member', 'token.1', 3600).removeCookie('old').cacheControl('private, max-age=60');
              return { id: 'member' };
            case 'guarded':
              reply.removeCookie('member');
              throw new Forbidden();
            case 'bad-cookie':
              reply.cookie('hy-keep', 'x');
              return { id: 'x' };
            case 'referrer':
              reply.referrerPolicy('same-origin');
              return { id: 'referrer' };
            case 'referrer-in-place':
              reply.status(403).referrerPolicy('origin');
              return { id: 'referrer-in-place' };
            case 'missing':
              throw new NotFound();
            case 'private':
              reply.note('refusal', 'private');
              throw new Forbidden();
            case 'unreadable':
              throw new BadRequest();
            case 'in-place':
              reply.status(403).cacheControl('private, max-age=60');
              return { id: 'in-place' };
            case 'in-place-moved':
              reply.status(403);
              throw new Redirect(Result.redirect('/items/new'));
            case 'other-status':
              reply.status(404);
              return { id: 'other-status' };
            case 'moved':
              throw new Redirect(Result.redirect('/items/new').flash('note', 'moved'));
            case 'broken':
              reply.note('stage', 'load');
              throw new Error('secret detail /srv/app.js');
            case 'renew':
              reply.renewSession();
              return { id: 'renew' };
            case 'huge':
              return { id: 9223372036854775807n };
            case 'numeric':
              return { labels: { 5: 'x' }, id: 'n' };
            case 'secret':
              return { id: 's', password: 'p', nested: { a: 1 } };
            default:
              return { id: request.param('id') };
          }
        },
      },
    },
  };
}

// A fixture application with one session and one counter, as the PHP AppTest sets them up.
export class Fixture {
  readonly session = new MemorySessionStore();
  readonly counter: Counter = { count: 0, actions: 0 };
  readonly log: string[] = [];

  async app(options: Partial<AppOptions<Services>> = {}): Promise<App<Services>> {
    const app = await App.open<Services>({
      manifest: `${FIXTURES}app.json`,
      templates: TEMPLATES,
      handlers: handlers(),
      timezone: '+09:00',
      log: (message) => this.log.push(message),
      ...options,
    });
    app.bind('counter', () => this.counter);
    return app;
  }

  async handle(init: { method?: string; target: string; headers?: Record<string, string>; body?: string; https?: boolean }, options: Partial<AppOptions<Services>> = {}): Promise<Response> {
    const headers = init.body === undefined ? init.headers : { 'Content-Type': 'application/x-www-form-urlencoded', ...init.headers };
    const request = Request.from({ method: init.method ?? 'GET', target: init.target, headers, body: init.body === undefined ? undefined : Buffer.from(init.body, 'latin1'), https: init.https });
    return (await this.app(options)).handle(request, this.session);
  }

  get(target: string, headers: Record<string, string> = {}, basePath = ''): Promise<Response> {
    return this.handle({ target, headers }, { basePath });
  }

  // Posts a form; a string form is the body as it is, so that a test can send bytes that are not UTF-8.
  post(target: string, form: Record<string, string> | string, headers: Record<string, string> = {}, basePath = ''): Promise<Response> {
    const body = typeof form === 'string' ? form : new URLSearchParams(form).toString();
    return this.handle({ method: 'POST', target, headers, body }, { basePath });
  }

  // Returns the masked token of a page response (HY-24). The route region of /list keeps a value on the server, so its
  // shared data keeps csrf (HY-73).
  async token(): Promise<string> {
    return text(json(await this.get('/list', JSON_REGION)).shared.csrf);
  }

  // Returns a body with every masked value of the session token replaced by `masked`, after it checks that each one
  // verifies, so two responses of one session compare equal although their masks differ (HY-24).
  unmasked(body: string): string {
    const token = text(this.session.get('_hyper_csrf'));
    return body.replace(/[0-9a-f]{128}/g, (found) => {
      expect(verifyToken(token, found), found).toBe(true);
      return 'masked';
    });
  }

  // Returns the tag of a JSON body of the current session token (HY-53).
  tag(body: string): string {
    const masked = record(record(parsed(body)).shared).csrf;
    const unmasked = masked === undefined ? body : body.replaceAll(text(masked), text(this.session.get('_hyper_csrf')));
    return `W/"${createHash('sha256').update(unmasked).digest('hex').slice(0, 32)}"`;
  }

  keep(form: Record<string, string>, method = 'POST'): Promise<Response> {
    return method === 'POST' ? this.post('/_hyper/keep', form) : this.handle({ method, target: '/_hyper/keep' });
  }
}

// Returns the Cookie header that holds one cookie with a URL-encoded value.
export function cookie(name: string, value: string): Record<string, string> {
  return { Cookie: `${name}=${encodeURIComponent(value)}` };
}

// The JSON of a page response: its shared data, the data of its regions and its kept values (HY-17).
export function json(response: Response): Record<string, unknown> & { shared: Record<string, unknown>; regions: Record<string, unknown>; kept: Record<string, unknown> } {
  const page = record(parsed(response.body));
  return { ...page, shared: record(page.shared), regions: record(page.regions), kept: record(page.kept) };
}

// The value of a JSON text, which a test narrows with record and text.
export function parsed(body: string): unknown {
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
export function text(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError(`${JSON.stringify(value)} is not a string`);
  return value;
}

// Returns a value that is a JSON array; another value fails the test.
export function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${JSON.stringify(value)} is not an array`);
  return value;
}

// Returns a JSON object whose values are strings, such as headers or form fields; another value fails the test.
export function strings(value: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(record(value)).map(([key, item]) => [key, text(item)]));
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

// A case of a contract of routes: the path and the match that the router gives for it.
export interface RouteCase {
  id: string;
  path: string;
  result: unknown;
}

// The cases of a list of a contract of routes, each as [id, case] for `it.each`.
export const routeCases = (value: unknown): [string, RouteCase][] => list(value).map(record).map((item) => [text(item.id), { id: text(item.id), path: text(item.path), result: item.result }]);

// The contract `contracts/<file>` of routes and the router that is built from its `routes`.
export function routeContract(file: string): { fixture: Record<string, unknown>; router: Router } {
  const fixture = record(parsed(readFileSync(new URL(`../../../../contracts/${file}`, import.meta.url), 'utf8')));
  const router = new Router(list(fixture.routes).map(record).map((route) => ({ name: text(route.name), path: text(route.path) })));
  return { fixture, router };
}

// Requires that `fields` is invalid when the contract expects null, and otherwise valid with the expected values.
export function expectFields(fields: { valid: boolean; values: Iterable<unknown> }, expected: unknown): void {
  if (expected === null) {
    expect(fields.valid).toBe(false);
    return;
  }
  expect(fields.valid).toBe(true);
  expect([...fields.values]).toEqual(expected);
}

// The contract of the client rendering (HY-62) and the declaration that its cases run against.
export const conformance = record(parsed(readFileSync(new URL('../../../../contracts/client.json', import.meta.url), 'utf8')));
const BASE_PATH = text(conformance.basePath);
const CHOSEN_HOST = text(conformance.chosenHost);
export const SHELL = `${FIXTURES}shell/index.html`;
// A session token of HY-24; the form carries a masked value of it.
export const TOKEN = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
export const client = (selects: ClientRendering['selects'] = (request) => ({ chosen: request.header('Host') === CHOSEN_HOST, value: null })): ClientRendering => ({ shell: SHELL, basePath: BASE_PATH, selects });
