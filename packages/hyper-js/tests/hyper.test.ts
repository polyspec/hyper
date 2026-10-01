import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hyper, parseAssignments, valueToJson, type KeepStorage, type RequestContext } from '../src/index.js';
import { parseJson } from '@polyspec/template';
import { testApplication } from './application.js';

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
  send(url: string, form: Record<string, string>): void {
    this.sent.push({ url, form });
  }
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
  return { hyper: new Hyper(testApplication(fetched), htmx, { basePath, element, storage }), swaps };
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
    expect(storage.writes).toEqual(['cookie:rows:flag=true', 'sessionStorage:rows:tab="b"', 'localStorage:rows:items.1.open=true']);
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

describe('parseAssignments', () => {
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
  });
});
