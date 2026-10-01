// The fixture application of the PHP server tests, served by the Node server.
import { fileURLToPath } from 'node:url';
import { App, Forbidden, MemorySessionStore, NotFound, Redirect, Request, Result, type AppOptions, type Handlers, type Response } from '../src/index.js';

export const FIXTURES = fileURLToPath(new URL('../../hyper-php/tests/fixtures/', import.meta.url));
// The template files of the fixtures, which `make test-node` builds with scripts/build-templates.mjs.
export const BUILD = fileURLToPath(new URL('./build/', import.meta.url));
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
        post: ({ request, services }) => {
          const counter = services.get('counter');
          counter.actions++;
          if (request.formString('name') === 'closed') throw new Forbidden();
          if (request.formString('name') === '') return Result.invalid({ name: '', error: 'empty' });
          counter.count++;
          return Result.redirect('/').flash('note', 'added').changed('count');
        },
      },
      list: {
        regions: {
          rows: ({ services }) => ({ items: ['a<', `b${services.get('counter').count}`], open: false, mode: 'a', view: 'x', filter: { a: 1 }, tags: [] }),
        },
      },
      item: {
        load: async ({ request, reply }) => {
          switch (request.param('id')) {
            case 'member':
              reply.cookie('member', 'token.1', 3600).removeCookie('old').cacheControl('public, max-age=60');
              return { id: 'member' };
            case 'guarded':
              reply.removeCookie('member');
              throw new Forbidden();
            case 'bad-cookie':
              reply.cookie('hy-keep', 'x');
              return { id: 'x' };
            case 'missing':
              throw new NotFound();
            case 'private':
              throw new Forbidden();
            case 'moved':
              throw new Redirect(Result.redirect('/items/new').flash('note', 'moved'));
            case 'broken':
              throw new Error('secret detail /srv/app.js');
            case 'huge':
              return { id: 9223372036854775807n };
            case 'numeric':
              return { 5: 'x', id: 'n' };
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

  async token(): Promise<string> {
    await this.get('/');
    return this.session.get('_hyper_csrf') as string;
  }

  keep(form: Record<string, string>, method = 'POST'): Promise<Response> {
    return method === 'POST' ? this.post('/_hyper/keep', form) : this.handle({ method, target: '/_hyper/keep' });
  }
}

// Returns the Cookie header that holds one cookie with a URL-encoded value.
export function cookie(name: string, value: string): Record<string, string> {
  return { Cookie: `${name}=${encodeURIComponent(value)}` };
}

export function json(response: Response): Record<string, unknown> & { regions: Record<string, unknown>; kept: Record<string, unknown> } {
  return JSON.parse(response.body);
}
