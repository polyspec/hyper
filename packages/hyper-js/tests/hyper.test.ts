import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyKept, decodeResponse, Hyper, parseAssignments, renderDocument, valueToJson, type KeepStorage, type RequestContext } from '../src/index.js';
import { parseJson } from '@polyspec/template';
import { sources, testApplication } from './application.js';

interface Swap { region: string; text: string; swap: string }

// A storage that records writes and requests and returns preset browser values.
class FakeStorage implements KeepStorage {
  readonly writes: string[] = [];
  readonly sent: { url: string; form: Record<string, string> }[] = [];
  constructor(readonly values: Record<string, string> = {}) {}
  read(kind: string, region: string, path: string): string | null {
    return this.values[`${kind}:${region}:${path}`] ?? null;
  }
  write(kind: string, region: string, path: string, json: string): void {
    this.writes.push(`${kind}:${region}:${path}=${json}`);
  }
  readonly saves: ((ok: boolean) => void)[] = [];
  send(url: string, form: Record<string, string>): Promise<boolean> {
    this.sent.push({ url, form });
    return new Promise((resolve) => this.saves.push(resolve));
  }
}

// A document adapter that records what client-side rendering mounts.
class FakeDocument {
  readonly mounted: string[] = [];
  mount(html: string): void {
    this.mounted.push(html);
  }
  text(text: string): void {
    this.mounted.push(`text:${text}`);
  }
  fail(status: string): void {
    this.mounted.push(`fail:${status}`);
  }
}

// A region element stub that records its hy-error attribute.
function regionElement(id: string): { id: string; attributes: Map<string, string>; hasAttribute(name: string): boolean; setAttribute(name: string, value: string): void; removeAttribute(name: string): void } {
  const attributes = new Map<string, string>([['hy-region', '']]);
  return {
    id,
    attributes,
    hasAttribute: (name) => attributes.has(name),
    setAttribute: (name, value) => { attributes.set(name, value); },
    removeAttribute: (name) => { attributes.delete(name); },
  };
}

function setup(basePath = '', fetched: string[] = [], storage = new FakeStorage()): { hyper: Hyper; swaps: Swap[] } {
  const swaps: Swap[] = [];
  const element = (id: string) => ({ id } as unknown as Element);
  const htmx = {
    process: () => undefined,
    swap: async (ctx: { text: string; target: Element; swap: string }) => {
      swaps.push({ region: (ctx.target as unknown as { id: string }).id, text: ctx.text, swap: ctx.swap });
    },
  };
  return { hyper: new Hyper(testApplication(fetched), htmx, { basePath, element, storage, currentUrl: () => 'http://localhost/' }), swaps };
}

function region(id: string): { id: string; hasAttribute(name: string): boolean } {
  return { id, hasAttribute: (name) => name === 'hy-region' };
}

function context(action: string, target: unknown = region('content')): RequestContext {
  return { target, request: { action, method: 'GET', headers: { Accept: 'text/html' } } };
}

function jsonResponse(url: string, body: string): Response {
  const response = new Response(body, { headers: { 'content-type': 'application/json' } });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

// Runs one region request through the extension hooks with a stubbed network response.
async function request(hyper: Hyper, action: string, responseUrl: string, body: string): Promise<RequestContext> {
  const extension = hyper.extension();
  const ctx = context(action);
  extension.htmx_config_request(null, { ctx });
  extension.htmx_before_request(null, { ctx });
  vi.stubGlobal('fetch', async () => jsonResponse(responseUrl, body));
  const response = await ctx.fetch!(ctx.request.action, {});
  ctx.response = { raw: { url: response.url }, headers: response.headers };
  ctx.text = await response.text();
  extension.htmx_after_request(null, { ctx });
  return ctx;
}

const listJson = '{"env":{"timezone":"Z"},"route":"list","params":{},"shared":{"title":"T","csrf":"token"},"regions":{"content":{"heading":"H"},"rows":{"items":[{"name":"a","open":true},{"name":"b","open":false}],"flag":false,"tab":"a"}}}';

afterEach(() => vi.unstubAllGlobals());

describe('template delivery', () => {
  it('loads only the templates of the requested route (HY-35)', async () => {
    const fetched: string[] = [];
    const { hyper } = setup('', fetched);
    await request(hyper, '/items/7', 'http://localhost/items/7', '{"env":{"timezone":"Z"},"route":"item","params":{"id":"7"},"shared":{"title":"T"},"regions":{"content":{"id":"7"}}}');
    expect(fetched.sort()).toEqual(['/t/hyper/data.tpl', '/t/item.tpl', '/t/layout.tpl', '/t/part.tpl', '/t/side.tpl', '/t/title.tpl']);
  });

  it('loads the templates of the route that a redirect reaches (HY-35)', async () => {
    const fetched: string[] = [];
    const { hyper } = setup('', fetched);
    const ctx = await request(hyper, '/', 'http://localhost/list', listJson);
    expect(fetched).toContain('/t/list.tpl');
    expect(fetched).toContain('/t/rows.tpl');
    expect(ctx.text).toBe('<title>T - Site</title><h1>H</h1><ul id="rows" hy-region><li class="open">a</li><li>b</li></ul>');
  });
});

describe('held data', () => {
  it('holds the data of a rendered response (HY-32)', async () => {
    const { hyper } = setup();
    await request(hyper, '/list', 'http://localhost/list', listJson);
    expect(hyper.data('content')).toEqual(new Map([['heading', 'H']]));
  });

  it('sets a nested value and renders only that region without a request (HY-33)', async () => {
    const { hyper, swaps } = setup();
    await request(hyper, '/list', 'http://localhost/list', listJson);
    vi.stubGlobal('fetch', () => { throw new Error('no request is allowed'); });
    await hyper.set('rows', 'items.0.open', false);
    await hyper.set('rows', 'items.1.open', true);
    expect(swaps.map((swap) => [swap.region, swap.swap])).toEqual([['rows', 'innerMorph'], ['rows', 'innerMorph']]);
    expect(swaps[1]!.text).toBe('<li>a</li><li class="open">b</li>');
  });

  it('renders the page region with the held route regions (HY-33)', async () => {
    const { hyper, swaps } = setup();
    await request(hyper, '/list', 'http://localhost/list', listJson);
    await hyper.render('content', { heading: 'New' });
    expect(swaps[0]!.text).toBe('<h1>New</h1><ul id="rows" hy-region><li class="open">a</li><li>b</li></ul>');
  });

  it('runs hy-set assignments in the region that contains the element (HY-36)', async () => {
    const { hyper, swaps } = setup();
    await request(hyper, '/list', 'http://localhost/list', listJson);
    const button = {
      closest: (selector: string) => (selector === '[hy-region]' ? { id: 'rows' } : null),
      getAttribute: () => 'items.0.open=false; items.0.name="x;y"',
    } as unknown as Element;
    await hyper.setFrom(button);
    expect(swaps[0]!.text).toBe('<li>x;y</li><li>b</li>');
  });

  it('fails for a path that the region data does not contain', async () => {
    const { hyper } = setup();
    await request(hyper, '/list', 'http://localhost/list', listJson);
    await expect(hyper.set('rows', 'items.5.open', true)).rejects.toThrow('does not exist');
    await expect(hyper.set('rows', 'missing.flag', 1)).rejects.toThrow('does not exist');
  });

  it('fails when nothing is held', async () => {
    await expect(setup().hyper.set('rows', 'a', 1)).rejects.toThrow('no response data');
  });
});

describe('kept data', () => {
  it('stores a changed kept value after rendering, by kind (HY-39)', async () => {
    const storage = new FakeStorage();
    const { hyper, swaps } = setup('/api', [], storage);
    await request(hyper, '/list', 'http://localhost/api/list', listJson);
    await hyper.set('rows', 'items.0.open', false);
    expect(swaps).toHaveLength(1);
    expect(storage.sent).toEqual([{ url: '/api/_hyper/keep', form: { _csrf: 'token', region: 'rows', path: 'items.0.open', value: 'false' } }]);

    const button = {
      closest: () => ({ id: 'rows' }),
      getAttribute: () => 'flag=true; tab="b"; items.1.open=true; items.1.name="c"',
    } as unknown as Element;
    await hyper.setFrom(button);
    // Kept paths are stored in declaration order.
    expect(storage.writes).toEqual(['localStorage:rows:items.1.open=true', 'cookie:rows:flag=true', 'sessionStorage:rows:tab="b"']);
  });

  it('applies browser kept values before rendering a response (HY-38)', async () => {
    const storage = new FakeStorage({ 'localStorage:rows:items.1.open': 'true', 'sessionStorage:rows:tab': '1', 'cookie:rows:flag': 'true' });
    const { hyper } = setup('', [], storage);
    const ctx = await request(hyper, '/list', 'http://localhost/list', listJson);
    expect(ctx.text).toBe('<title>T - Site</title><h1>H</h1><ul id="rows" hy-region><li class="open">a</li><li class="open">b</li></ul>');
    const rows = hyper.data('rows') as Map<string, unknown>;
    expect(rows.get('tab')).toBe('a');
    expect(rows.get('flag')).toBe(false);
  });

  it('renders embedded regions again when browser kept values change them (HY-38)', async () => {
    const storage = new FakeStorage({ 'localStorage:rows:items.1.open': 'true' });
    const { hyper, swaps } = setup('', [], storage);
    await hyper.holdEmbedded(listJson, '/list');
    expect(swaps.map((swap) => swap.region)).toEqual(['rows']);

    const unchanged = setup('', [], new FakeStorage());
    await unchanged.hyper.holdEmbedded(listJson, '/list');
    expect(unchanged.swaps).toEqual([]);
  });

  it('writes JSON with map keys in their order', () => {
    expect(valueToJson(parseJson('{"2":1,"1":[true,null,"x"],"a":{"b":1.5}}'))).toBe('{"2":1,"1":[true,null,"x"],"a":{"b":1.5}}');
  });
});

describe('held data, restorations and kept values', () => {
  it('replaces all held data from #hy-data after an SSR history restore (HY-32)', async () => {
    const embedded = '{"env":{"timezone":"Z"},"route":"item","params":{"id":"7"},"shared":{"title":"T","csrf":"t"},"regions":{"side":{"count":1},"content":{"id":"7"}}}';
    const swaps: Swap[] = [];
    const element = (id: string) => (id === 'hy-data' ? ({ textContent: embedded } as unknown as Element) : ({ id } as unknown as Element));
    const htmx = { process: () => undefined, swap: async (ctx: { text: string; target: Element; swap: string }) => { swaps.push({ region: '', text: ctx.text, swap: ctx.swap }); } };
    const hyper = new Hyper(testApplication(), htmx, { basePath: '', element, storage: new FakeStorage() });
    await request(hyper, '/list', 'http://localhost/list', listJson);
    const ctx = context('/items/7', { id: '', hasAttribute: () => false });
    ctx.request.headers['HX-History-Restore-Request'] = 'true';
    hyper.extension().htmx_after_swap(null, { ctx });
    await new Promise((done) => setTimeout(done, 0));
    expect(hyper.data('rows')).toBeUndefined();
    expect(hyper.data('content')).toEqual(new Map([['id', '7']]));
  });

  it('ignores swaps that have no request, such as those of render and set', () => {
    const { hyper } = setup();
    expect(() => hyper.extension().htmx_after_swap(null, { ctx: {} as RequestContext })).not.toThrow();
  });

  it('keeps the embedded data free of browser kept values (HY-31, HY-38)', async () => {
    const app = testApplication();
    await app.templates.ensure(Object.keys(sources));
    const decoded = decodeResponse(app, parseJson(listJson.replace('"tab":"a"', '"tab":"a"')), '/list');
    applyKept(decoded.regions.get('rows') as Map<string, never>, [['items.1.open', true]]);
    const html = renderDocument(app, { ...decoded, regions: new Map([...decoded.regions, ['side', new Map([['count', 0]])]]) });
    expect(html).toContain('<li class="open">b</li>');
    expect(html).toContain('{"name":"b","open":false}');
  });

  it('renders only the latest of overlapping client-side restorations (HY-23)', async () => {
    const releases: (() => void)[] = [];
    const page = new FakeDocument();
    const respond = (body: string) => new Promise<Response>((resolve) => releases.push(() => resolve(jsonResponse('', body))));
    const app = testApplication();
    const hyper = new Hyper(app, { process: () => undefined, swap: async () => undefined }, {
      basePath: '/api',
      storage: new FakeStorage(),
      fetch: (input) => respond(String(input).includes('/list') ? listJson.replace('"heading":"H"', '"heading":"LIST"').replace('"regions":{', '"regions":{"side":{"count":1},') : '{"env":{"timezone":"Z"},"route":"item","params":{"id":"7"},"shared":{"title":"T","csrf":"t"},"regions":{"side":{"count":1},"content":{"id":"7"}}}'),
      document: page,
    });
    const first = hyper.renderLocation('/list');
    const second = hyper.renderLocation('/items/7');
    await new Promise((done) => setTimeout(done, 0));
    releases[1]!();
    await second;
    releases[0]!();
    await first;
    expect(page.mounted).toHaveLength(1);
    expect(page.mounted[0]).toContain('<i>7</i>');
    expect(hyper.data('content')).toEqual(new Map([['id', '7']]));
  });

  it('fails to set a map key that the data does not contain (HY-33)', async () => {
    const { hyper } = setup();
    await request(hyper, '/list', 'http://localhost/list', listJson);
    await expect(hyper.set('rows', 'nosuchkey', 1)).rejects.toThrow();
    expect((hyper.data('rows') as Map<string, unknown>).has('nosuchkey')).toBe(false);
  });

  it('stores kept paths under or above a changed path (HY-39)', async () => {
    const storage = new FakeStorage();
    const { hyper } = setup('', [], storage);
    await request(hyper, '/list', 'http://localhost/list', listJson);
    await hyper.set('rows', 'items', [{ name: 'a', open: false }, { name: 'b', open: true }]);
    expect(storage.sent.map((item) => [item.form.path, item.form.value])).toEqual([['items.0.open', 'false']]);
    expect(storage.writes).toEqual(['localStorage:rows:items.1.open=true']);
  });

  it('prefixes every same-origin region request with the base path (HY-23)', () => {
    const extension = setup('/api').hyper.extension();
    const ctx = context('/api/7');
    extension.htmx_config_request(null, { ctx });
    expect(ctx.request.action).toBe('/api/api/7');
  });

  it('does not swap a non-JSON region response and marks the region (HY-47)', async () => {
    const { hyper } = setup();
    const extension = hyper.extension();
    const target = regionElement('content');
    const ctx = context('/items/7', target);
    extension.htmx_config_request(null, { ctx });
    ctx.response = { raw: { url: 'http://localhost/items/7' }, status: 500, headers: new Headers({ 'content-type': 'text/plain' }) };
    ctx.text = '<b>boom</b>';
    expect(extension.htmx_after_request(null, { ctx })).toBe(false);
    expect(target.attributes.get('hy-error')).toBe('500');

    const ok = context('/list', target);
    extension.htmx_config_request(null, { ctx: ok });
    ok.response = { raw: { url: 'http://localhost/list' }, status: 200, headers: new Headers({ 'content-type': 'application/json' }) };
    ok.text = listJson;
    await hyper.app.templates.ensure(Object.keys(sources));
    extension.htmx_after_request(null, { ctx: ok });
    expect(target.attributes.has('hy-error')).toBe(false);
  });

  it('marks the region when htmx reports an error (HY-47)', () => {
    const { hyper } = setup();
    const extension = hyper.extension();
    const target = regionElement('content');
    const ctx = context('/', target);
    extension.htmx_config_request(null, { ctx });
    extension.htmx_error(null, { ctx });
    expect(target.attributes.get('hy-error')).toBe('0');
    const plain = regionElement('other');
    plain.attributes.delete('hy-region');
    extension.htmx_error(null, { ctx: context('/', plain) });
    expect(plain.attributes.has('hy-error')).toBe(false);
  });

  it('applies a pending server value over a response until the save completes (HY-38, HY-39)', async () => {
    const storage = new FakeStorage();
    const { hyper } = setup('', [], storage);
    await request(hyper, '/list', 'http://localhost/list', listJson);
    await hyper.set('rows', 'items.0.open', false);
    const pending = await request(hyper, '/list', 'http://localhost/list', listJson);
    expect(pending.text).toContain('<li>a</li>');
    storage.saves[0]!(true);
    await new Promise((done) => setTimeout(done, 0));
    const saved = await request(hyper, '/list', 'http://localhost/list', listJson);
    expect(saved.text).toContain('<li class="open">a</li>');
  });
});

describe('restorations, saves and failure marks', () => {
  it('cancels a pending client-side restoration when a region request starts (HY-23)', async () => {
    let release: () => void = () => undefined;
    const page = new FakeDocument();
    const hyper = new Hyper(testApplication(), { process: () => undefined, swap: async () => undefined }, {
      basePath: '/api',
      storage: new FakeStorage(),
      document: page,
      currentUrl: () => 'http://localhost/list',
      fetch: () => new Promise<Response>((resolve) => { release = () => resolve(jsonResponse('', listJson)); }),
    });
    const restoring = hyper.renderLocation('/list');
    const ctx = context('/');
    hyper.extension().htmx_config_request(null, { ctx });
    hyper.extension().htmx_before_request(null, { ctx });
    release();
    await restoring;
    expect(page.mounted).toEqual([]);
  });

  it('keeps a pending value when its save fails, and clears only the saved change (HY-39)', async () => {
    const storage = new FakeStorage();
    const { hyper } = setup('', [], storage);
    await request(hyper, '/list', 'http://localhost/list', listJson);
    await hyper.set('rows', 'items.0.open', false);
    storage.saves[0]!(false);
    await new Promise((done) => setTimeout(done, 0));
    expect((await request(hyper, '/list', 'http://localhost/list', listJson)).text).toContain('<li>a</li>');

    await hyper.set('rows', 'items.0.open', true);
    await hyper.set('rows', 'items.0.open', false);
    storage.saves[1]!(true);
    await new Promise((done) => setTimeout(done, 0));
    expect((await request(hyper, '/list', 'http://localhost/list', listJson)).text).toContain('<li>a</li>');
  });

  it('leaves held data unchanged and marks the region when rendering fails (HY-47)', async () => {
    const target = regionElement('rows');
    const swaps: string[] = [];
    const hyper = new Hyper(testApplication(), { process: () => undefined, swap: async (ctx) => { swaps.push(ctx.text); } }, {
      basePath: '',
      storage: new FakeStorage(),
      element: (id) => (id === 'rows' ? (target as unknown as Element) : ({ id } as unknown as Element)),
    });
    await request(hyper, '/list', 'http://localhost/list', listJson);
    await expect(hyper.render('rows', { items: 5, flag: false, tab: 'a' })).rejects.toThrow();
    expect(swaps).toEqual([]);
    expect((hyper.data('rows') as Map<string, unknown>).get('items')).toHaveLength(2);
    expect(target.attributes.get('hy-error')).toBe('0');
  });

  it('removes the mark from every region that a response renders (HY-47)', async () => {
    const side = regionElement('side');
    side.attributes.set('hy-error', '500');
    const hyper = new Hyper(testApplication(), { process: () => undefined, swap: async () => undefined }, {
      basePath: '',
      storage: new FakeStorage(),
      element: (id) => (id === 'side' ? (side as unknown as Element) : ({ id } as unknown as Element)),
    });
    await hyper.app.templates.ensure(Object.keys(sources));
    const extension = hyper.extension();
    const ctx = context('/');
    extension.htmx_config_request(null, { ctx });
    ctx.response = { raw: { url: 'http://localhost/' }, status: 200, headers: new Headers({ 'content-type': 'application/json' }) };
    ctx.text = '{"env":{"timezone":"Z"},"route":"home","params":{},"shared":{"title":"T","csrf":"t"},"regions":{"content":{"name":"n"},"side":{"count":2}}}';
    extension.htmx_after_request(null, { ctx });
    expect(side.attributes.has('hy-error')).toBe(false);
  });

  it('prefixes absolute same-origin and relative region request URLs (HY-23)', () => {
    const hyper = new Hyper(testApplication(), { process: () => undefined, swap: async () => undefined }, {
      basePath: '/api',
      storage: new FakeStorage(),
      currentUrl: () => 'http://localhost:3000/list',
    });
    const extension = hyper.extension();
    for (const [action, expected] of [['http://localhost:3000/items/7', '/api/items/7'], ['?page=2', '/api/list?page=2'], ['https://other.example/x', 'https://other.example/x']] as const) {
      const ctx = context(action);
      extension.htmx_config_request(null, { ctx });
      expect(ctx.request.action).toBe(expected);
    }
  });

  it('does not mark a region for a cancelled request (HY-47)', () => {
    const extension = setup().hyper.extension();
    const target = regionElement('content');
    const ctx = context('/', target);
    extension.htmx_config_request(null, { ctx });
    extension.htmx_error(null, { ctx, error: new DOMException('aborted', 'AbortError') });
    extension.htmx_error(null, { ctx, error: new Error('failed') });
    expect(target.attributes.get('hy-error')).toBe('0');
    target.attributes.delete('hy-error');
    extension.htmx_error(null, { ctx, error: new DOMException('aborted', 'AbortError') });
    expect(target.attributes.has('hy-error')).toBe(false);
  });

  it('marks the body when client-side rendering of a document fails (HY-47)', async () => {
    const page = new FakeDocument();
    const hyper = new Hyper(testApplication(), { process: () => undefined, swap: async () => undefined }, {
      basePath: '/api',
      storage: new FakeStorage(),
      document: page,
      fetch: async () => { throw new TypeError('network'); },
    });
    await hyper.renderLocation('/list');
    expect(page.mounted).toEqual(['fail:0']);
  });
});

describe('parseAssignments', () => {
  it('parses a string that ends with a backslash', () => {
    expect(parseAssignments('a="x\\\\"; b=1')).toEqual([{ path: 'a', value: 'x\\' }, { path: 'b', value: 1 }]);
  });

  it('parses paths and JSON literals separated by semicolons', () => {
    expect(parseAssignments('service.close.flag=0; name = "a;b" ;list.2.on=true;x=null')).toEqual([
      { path: 'service.close.flag', value: 0 },
      { path: 'name', value: 'a;b' },
      { path: 'list.2.on', value: true },
      { path: 'x', value: null },
    ]);
  });

  it('rejects an assignment that is not a path and a JSON literal', () => {
    expect(() => parseAssignments('a.b = c')).toThrow();
    expect(() => parseAssignments('a..b=1')).toThrow('invalid hy-set');
    expect(() => parseAssignments('1a=1')).toThrow('invalid hy-set');
  });
});

describe('extension', () => {
  it('requests JSON only for a region target (HY-21)', () => {
    const extension = setup().hyper.extension();
    const plain = context('/', { id: 'x', hasAttribute: () => false });
    extension.htmx_config_request(null, { ctx: plain });
    expect(plain.request.headers).toEqual({ Accept: 'text/html' });
    const target = context('/');
    extension.htmx_config_request(null, { ctx: target });
    expect(target.request.headers).toEqual({ Accept: 'application/json', 'Hy-Region': 'content' });
  });

  it('passes a non-JSON response unchanged', () => {
    const extension = setup().hyper.extension();
    const ctx = context('/');
    extension.htmx_config_request(null, { ctx });
    ctx.response = { raw: { url: 'http://localhost/' }, headers: new Headers({ 'content-type': 'text/plain' }) };
    ctx.text = 'Not Found';
    extension.htmx_after_request(null, { ctx });
    expect(ctx.text).toBe('Not Found');
  });

  it('prefixes requests, strips history paths and replaces restoration under a base path (HY-23)', async () => {
    const { hyper } = setup('/api');
    const extension = hyper.extension();
    const ctx = context('/items/7?x=1');
    extension.htmx_config_request(null, { ctx });
    expect(ctx.request.action).toBe('/api/items/7?x=1');
    const history = { history: { type: 'push', path: '/api/items/7?x=1' } };
    extension.htmx_before_history_update(null, history);
    expect(history.history.path).toBe('/items/7?x=1');
    await request(hyper, '/list', 'http://localhost/api/list', listJson);
    expect(hyper.data('rows')).toBeDefined();

    const page = new FakeDocument();
    const requested: string[] = [];
    const itemJson = '{"env":{"timezone":"Z"},"route":"item","params":{"id":"7"},"shared":{"title":"T","csrf":"t"},"regions":{"side":{"count":1},"content":{"id":"7"}}}';
    const restoring = new Hyper(testApplication(), { process: () => undefined, swap: async () => undefined }, {
      basePath: '/api',
      storage: new FakeStorage(),
      document: page,
      fetch: async (input) => {
        requested.push(String(input));
        return jsonResponse('', itemJson);
      },
    });
    expect(restoring.extension().htmx_before_history_restore(null, { path: '/items/7' })).toBe(false);
    await vi.waitFor(() => expect(page.mounted).toHaveLength(1));
    expect(requested).toEqual(['/api/items/7']);
    expect(page.mounted[0]).toContain('<i>7</i>');
  });
});
