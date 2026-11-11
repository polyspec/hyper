import { parse, type Template } from '@polyspec/template';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApplication, Hyper, type Application, type DocumentAdapter, type HtmxApi, type KeepStorage, type RegionElement, type RequestContext, type TemplateIndex } from '../src/index.js';
import { defined } from './values.js';
import { manifest, sources } from './application.js';

// The build id of the test page, which its meta element holds (HY-125), and another build id (HYC-22).
const BUILD = 'a'.repeat(64);
// The text of a page region that renders `name` with the title of the test (title.tpl, shared title T).
function rendered(name: string): string {
  return `<title>T - Site</title>${name}`;
}
const OTHER_BUILD = 'b'.repeat(64);
// The context hashes of the test (HY-125): the first and the second one.
const HASH = '1'.repeat(64);
const OTHER_HASH = '2'.repeat(64);

interface Swap { region: string; text: string }

// A document adapter that records the URLs it is asked to load as a new document (HYC-22).
class ContextDocument implements DocumentAdapter {
  build: () => string | null = () => BUILD;
  readonly assigned: string[] = [];
  readonly mounted: string[] = [];
  // The HTML of every stylesheet step, which holds the layout of a region response (HYC-15).
  readonly styled: string[] = [];
  async stylesheets(html: string): Promise<() => void> {
    this.styled.push(html);
    return () => undefined;
  }
  mount(html: string): void {
    this.mounted.push(html);
  }
  text(text: string): void {
    this.mounted.push(text);
  }
  fail(status: string): void {
    this.mounted.push(`fail:${status}`);
  }
  elements(): number {
    return 1;
  }
  assign(url: string): void {
    this.assigned.push(url);
  }
}

// A storage without kept values.
const emptyStorage: KeepStorage = {
  read: () => null,
  write: () => undefined,
  send: async () => true,
};

// The page region element of a test; it records the hy-error attribute and any element that a test asks for.
function element(id: string): RegionElement & { attributes: Map<string, string> } {
  const attributes = new Map<string, string>();
  return {
    id,
    attributes,
    setAttribute: (name, value) => { attributes.set(name, value); },
    removeAttribute: (name) => { attributes.delete(name); },
  };
}

// The application of the context route, whose page region prints the name of the application context (HY-124). A
// layout replaces the layout of the test application.
function contextApplication(layout?: string): Application {
  const all: Record<string, string> = { ...sources, 'context.tpl': '{= context.name}', ...(layout === undefined ? {} : { 'layout.tpl': layout }) };
  const routes = [...manifest.routes, { name: 'context', path: '/context', title: 'Context', template: 'context.tpl' }];
  const parsed: Record<string, Template> = Object.fromEntries(Object.entries(all).map(([name, source]) => [name, parse(source, name)]));
  const index: TemplateIndex = Object.fromEntries(Object.keys(all).map((name) => [name, { url: `/t/${name}` }]));
  return createApplication({ ...manifest, routes }, index, async (url) => defined(parsed[url.slice('/t/'.length)], `the template of ${url}`));
}

// The JSON response of a route (HY-17): the build id, and the context member when the test gives one (HY-128).
function responseBody(route: string, build: string, context: object | null, regions: object): string {
  return JSON.stringify({
    env: { timezone: 'Z' },
    route,
    params: {},
    build,
    ...(context === null ? {} : { context }),
    shared: { title: 'T' },
    regions,
    kept: {},
  });
}

// The JSON response of the context route with the page region data of the test.
function contextBody(context: object | null, build = BUILD): string {
  return responseBody('context', build, context, { content: {} });
}

// A JSON response whose URL is `url`, as the server answers it (HY-17).
function jsonResponse(url: string, body: string): Response {
  const response = new Response(body, { headers: { 'content-type': 'application/vnd.hyper+json' } });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

// The client of a test: its page, its swaps, its elements and the requests that it sends (HYC-3, HYC-22).
function client(options: { page?: ContextDocument; basePath?: string; currentUrl?: string; elements?: Map<string, ReturnType<typeof element>>; hy?: { textContent: string }; layout?: string } = {}) {
  const page = options.page ?? new ContextDocument();
  const elements = options.elements ?? new Map<string, ReturnType<typeof element>>();
  // the page region element, which the region requests of the test target
  if (!elements.has('content')) elements.set('content', element('content'));
  const swaps: Swap[] = [];
  const htmx: HtmxApi<RegionElement> = {
    process: () => undefined,
    swap: async () => undefined,
    find: () => null,
    config: { defaultTimeout: 60000 },
    parseInterval: Number,
  };
  const hyper = new Hyper<RegionElement>(contextApplication(options.layout), htmx, {
    basePath: options.basePath ?? '',
    element: (id) => {
      if (id === 'hy-data') return options.hy === undefined ? null : { id, textContent: options.hy.textContent };
      let found = elements.get(id);
      if (found === undefined) {
        found = element(id);
        elements.set(id, found);
      }
      return found;
    },
    storage: emptyStorage,
    document: page,
    currentUrl: () => `http://localhost${options.currentUrl ?? '/context'}`,
  });
  return { hyper, page, swaps, elements };
}

// Runs one region request of `action` through the extension hooks, as htmx does: the request headers are the
// headers that the fetch receives, and `answer` gives the response with its URL.
type Client = ReturnType<typeof client>;

// Runs one region request of `action` through the extension hooks, as htmx does: the request headers are the headers
// that the fetch receives, `answer` gives the response, and a failure of the fetch or of the after-request hook reaches
// the error hook, which marks the page region (HYC-14).
async function regionRequest(c: Client, action: string, answer: () => Response): Promise<{ ctx: RequestContext; headers: Record<string, string> }> {
  const ctx = startRegion(c, action);
  const sent: Record<string, string>[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    sent.push({ ...(init.headers as Record<string, string>) });
    return answer();
  });
  try {
    const response = await fetchRegion(ctx);
    await finishRegion(c, ctx, response);
  } catch (error) {
    c.hyper.extension().htmx_error(null, { ctx, error });
  }
  return { ctx, headers: defined(sent.at(-1), 'the sent request headers') };
}

// Runs the request hooks of htmx before the fetch of a region request of `action` (HYC-2, HYC-3).
function startRegion(c: Client, action: string): RequestContext {
  const extension = c.hyper.extension();
  const ctx: RequestContext = { target: defined(c.elements.get('content'), 'the element content'), request: { action, method: 'GET', headers: { Accept: 'text/html' }, abort: () => undefined } };
  extension.htmx_config_request(null, { ctx });
  extension.htmx_before_request(null, { ctx });
  return ctx;
}

// Runs the fetch hook of a started region request with its request headers, as htmx does.
function fetchRegion(ctx: RequestContext): Promise<Response> {
  return defined(ctx.fetch, 'the fetch of the request context')(ctx.request.action, { headers: { ...ctx.request.headers } });
}

// Completes a region request with its response: htmx swaps the text into the page region, unless the after-request hook
// cancels the swap (HYC-2).
async function finishRegion(c: Client, ctx: RequestContext, response: Response): Promise<void> {
  ctx.response = { raw: { url: response.url }, status: response.status, headers: response.headers };
  ctx.text = await response.text();
  if (c.hyper.extension().htmx_after_request(null, { ctx }) !== false) c.swaps.push({ region: 'content', text: ctx.text });
}

afterEach(() => vi.unstubAllGlobals());

describe('the build of the page (HYC-22, HY-125)', () => {
  it('reads the build from the meta element when the client is created and fails without it', () => {
    const page = new ContextDocument();
    page.build = () => null;
    expect(() => client({ page })).toThrow('hyper-build');
  });

  it('renders a region response of the build of the page', async () => {
    const c = client();
    const { swaps, page } = c;
    await regionRequest(c, '/context', () => jsonResponse('http://localhost/context', contextBody({ hash: HASH, value: { name: 'Board' } })));
    expect(swaps).toEqual([{ region: 'content', text: rendered('Board') }]);
    expect(page.assigned).toEqual([]);
  });

  it('loads the page URL of a region response of another build as a new document, without rendering (HYC-22)', async () => {
    const c = client();
    const { hyper, swaps, page } = c;
    const { ctx } = await regionRequest(c, '/context', () => jsonResponse('http://localhost/context?page=2', contextBody(null, OTHER_BUILD)));
    expect(page.assigned).toEqual(['/context?page=2']);
    expect(swaps).toEqual([]);
  });

  it('strips the base path from the page URL of another build (HYC-22, HY-62)', async () => {
    const c = client({ basePath: '/api' });
    const { hyper, page, swaps } = c;
    await regionRequest(c, '/context?page=2', () => jsonResponse('http://localhost/api/context?page=2', contextBody(null, OTHER_BUILD)));
    expect(page.assigned).toEqual(['/context?page=2']);
    expect(swaps).toEqual([]);
  });

  it('loads the page URL of a document request of another build as a new document, without rendering (HYC-22)', async () => {
    const page = new ContextDocument();
    const hyper = new Hyper<RegionElement>(contextApplication(), {
      process: () => undefined, swap: async () => undefined, find: () => null, config: { defaultTimeout: 60000 }, parseInterval: Number,
    }, {
      basePath: '', element: (id) => element(id), storage: emptyStorage, document: page, currentUrl: () => 'http://localhost/list?page=2',
      fetch: async () => jsonResponse('http://localhost/list?page=2', responseBody('list', OTHER_BUILD, null, { content: { heading: 'H' }, rows: { items: [], flag: false, tab: 'a' } })),
    });
    await expect(hyper.data('rows')).rejects.toThrow('hyper: the document of /list?page=2');
    expect(page.assigned).toEqual(['/list?page=2']);
    expect(page.mounted).toEqual([]);
  });
});

describe('the context of the application (HYC-22, HY-122, HY-128)', () => {
  it('sends no Hyper-Context header before a response holds the context, and sends the held hash after one (HYC-22, HY-127)', async () => {
    const c = client();
    const { hyper, swaps } = c;
    const first = await regionRequest(c, '/context', () => jsonResponse('http://localhost/context', contextBody({ hash: HASH, value: { name: 'Board' } })));
    expect(first.headers).not.toHaveProperty('Hyper-Context');
    expect(swaps).toEqual([{ region: 'content', text: rendered('Board') }]);
    const second = await regionRequest(c, '/context', () => jsonResponse('http://localhost/context', contextBody({ hash: HASH })));
    expect(second.headers['Hyper-Context']).toBe(HASH);
  });

  it('keeps the held context when a response without value has the held hash, and renders it in shared.context (HYC-22)', async () => {
    const c = client();
    const { hyper, swaps } = c;
    await regionRequest(c, '/context', () => jsonResponse('http://localhost/context', contextBody({ hash: HASH, value: { name: 'Board' } })));
    await regionRequest(c, '/context', () => jsonResponse('http://localhost/context', contextBody({ hash: HASH })));
    expect(swaps.map((swap) => swap.text)).toEqual([rendered('Board'), rendered('Board')]);
  });

  it('replaces the held context with the value of a response (HYC-22)', async () => {
    const c = client();
    const { hyper, swaps } = c;
    await regionRequest(c, '/context', () => jsonResponse('http://localhost/context', contextBody({ hash: HASH, value: { name: 'Board' } })));
    const replaced = await regionRequest(c, '/context', () => jsonResponse('http://localhost/context', contextBody({ hash: OTHER_HASH, value: { name: 'Post' } })));
    expect(swaps.map((swap) => swap.text)).toEqual([rendered('Board'), rendered('Post')]);
    expect(replaced.headers['Hyper-Context']).toBe(HASH);
  });

  it('marks the region and renders nothing for a response without value whose hash differs from the held hash (HYC-14, HYC-22)', async () => {
    const c = client();
    const { hyper, swaps, elements } = c;
    await regionRequest(c, '/context', () => jsonResponse('http://localhost/context', contextBody({ hash: HASH, value: { name: 'Board' } })));
    await regionRequest(c, '/context', () => jsonResponse('http://localhost/context', contextBody({ hash: OTHER_HASH })));
    expect(swaps.map((swap) => swap.text)).toEqual([rendered('Board')]);
    expect(defined(elements.get('content'), 'the element content').attributes.get('hy-error')).toBe('0');
  });

  it('marks the region for a response without value when no context is held (HYC-14, HYC-22)', async () => {
    const c = client();
    const { hyper, swaps, elements } = c;
    await regionRequest(c, '/context', () => jsonResponse('http://localhost/context', contextBody({ hash: HASH })));
    expect(swaps).toEqual([]);
    expect(defined(elements.get('content'), 'the element content').attributes.get('hy-error')).toBe('0');
  });

  it('sends no Hyper-Context header for an application without a context member, and keeps the held hash of none (HY-128)', async () => {
    const c = client();
    const { hyper } = c;
    await regionRequest(c, '/context', () => jsonResponse('http://localhost/context', contextBody(null)));
    const next = await regionRequest(c, '/context', () => jsonResponse('http://localhost/context', contextBody(null)));
    expect(next.headers).not.toHaveProperty('Hyper-Context');
  });

  it('holds the context of the embedded data of a document, and sends its hash with the next region request (HY-31, HYC-22)', async () => {
    const embedded = responseBody('context', BUILD, { hash: HASH, value: { name: 'Board' } }, { content: {} });
    const c = client({ hy: { textContent: embedded } });
    const { hyper } = c;
    await hyper.open();
    const next = await regionRequest(c, '/context', () => jsonResponse('http://localhost/context', contextBody({ hash: HASH })));
    expect(next.headers['Hyper-Context']).toBe(HASH);
  });

  it('sends the held hash with a document request, and holds the context of its answer (HYC-7, HYC-22, HY-127)', async () => {
    const requests: Record<string, string>[] = [];
    const list = responseBody('list', BUILD, { hash: HASH, value: { name: 'Board' } }, { content: { heading: 'H' }, rows: { items: [], flag: false, tab: 'a' } });
    const hyper = new Hyper<RegionElement>(contextApplication(), {
      process: () => undefined, swap: async () => undefined, find: () => null, config: { defaultTimeout: 60000 }, parseInterval: Number,
    }, {
      basePath: '', element: (id) => element(id), storage: emptyStorage, document: new ContextDocument(), currentUrl: () => 'http://localhost/list?page=2',
      fetch: async (_url, init) => {
        requests.push({ ...(init.headers as Record<string, string>) });
        return jsonResponse('http://localhost/list?page=2', list);
      },
    });
    await hyper.data('rows');
    expect(requests[0]).not.toHaveProperty('Hyper-Context');
    hyper.release();
    await hyper.data('rows');
    expect(requests[1]?.['Hyper-Context']).toBe(HASH);
  });
});

describe('the build in the layout of a region response (HYC-15, HYC-22)', () => {
  it('renders the build of the page as the definition build of the layout for its stylesheet links', async () => {
    const c = client({ layout: '<link rel="stylesheet" href="/app.css">{# build}{# title}{# side}{# content}{# data}' });
    await regionRequest(c, '/context', () => jsonResponse('http://localhost/context', contextBody({ hash: HASH, value: { name: 'Board' } })));
    expect(c.page.styled).toHaveLength(1);
    expect(c.page.styled[0]).toContain(`<meta name="hyper-build" content="${BUILD}">`);
    expect(c.swaps).toEqual([{ region: 'content', text: rendered('Board') }]);
  });
});

describe('the context of a document without embedded data (HYC-22)', () => {
  it('forgets the held context when a document without embedded data loads, so its next JSON request has no Hyper-Context', async () => {
    const c = client();
    const { hyper } = c;
    await regionRequest(c, '/context', () => jsonResponse('http://localhost/context', contextBody({ hash: HASH, value: { name: 'Board' } })));
    await hyper.open();
    const next = await regionRequest(c, '/context', () => jsonResponse('http://localhost/context', contextBody({ hash: HASH })));
    expect(next.headers).not.toHaveProperty('Hyper-Context');
  });
});

describe('the latest region request (HYC-23)', () => {
  it('renders no response of an earlier region request and holds none of its context', async () => {
    const c = client();
    const { swaps } = c;
    let answerEarlier: (response: Response) => void = () => undefined;
    const earlier = new Promise<Response>((resolve) => { answerEarlier = resolve; });
    const answers: (() => Promise<Response>)[] = [
      () => earlier,
      () => Promise.resolve(jsonResponse('http://localhost/context', contextBody({ hash: HASH, value: { name: 'Board' } }))),
    ];
    vi.stubGlobal('fetch', async () => defined(answers.shift(), 'the answer of a request')());
    const first = startRegion(c, '/context');
    const firstFetch = fetchRegion(first);
    const second = startRegion(c, '/context');
    await finishRegion(c, second, await fetchRegion(second));
    answerEarlier(jsonResponse('http://localhost/context', contextBody({ hash: OTHER_HASH, value: { name: 'Post' } })));
    await finishRegion(c, first, await firstFetch);
    expect(swaps).toEqual([{ region: 'content', text: rendered('Board') }]);
    const next = await regionRequest(c, '/context', () => jsonResponse('http://localhost/context', contextBody({ hash: HASH })));
    expect(next.headers['Hyper-Context']).toBe(HASH);
  });
});
