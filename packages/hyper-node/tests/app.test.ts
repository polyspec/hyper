// The cases of packages/hyper-php/tests/AppTest.php against the same fixture application (HY-54).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApplication, decodeResponse, renderParts, type Manifest, type TemplateIndex } from '@polyspec/hyper';
import { parseJson, type Template } from '@polyspec/template/render';
import { App, Request, Result, type Reply, type Response } from '../src/index.js';
import { cookie, Fixture, FIXTURES, handlers, json, JSON_REGION, TEMPLATES } from './support.js';

let fixture: Fixture;
beforeEach(() => {
  fixture = new Fixture();
});

describe('App', () => {
  it('renders the document for an HTML request (HY-12, HY-15)', async () => {
    const response = await fixture.get('/');
    expect(response.status).toBe(200);
    expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8');
    const token = fixture.session.get('_hyper_csrf') as string;
    const data = `{"env":{"timezone":"+09:00"},"route":"home","params":{},"shared":{"title":"Home","csrf":"${token}"},`
      + '"regions":{"side":{"count":0,"note":null},"content":{"name":"n0"}},"kept":{}}';
    expect(response.body).toBe(
      '<title>Home - Site</title>\n<aside id="side"><b>0</b>\n</aside>\n<main id="content"><p>Home|n0</p>\n</main>\n'
      + `<script type="application/json" id="hy-data">${data}</script>`,
    );
  });

  it('renders parts alone that match the document (HY-13)', async () => {
    const manifest = JSON.parse(readFileSync(`${FIXTURES}app.json`, 'utf8')) as Manifest;
    const index = JSON.parse(readFileSync(TEMPLATES.index, 'utf8')) as TemplateIndex;
    const application = createApplication(manifest, index, async (url) => JSON.parse(readFileSync(`${TEMPLATES.root}${url}`, 'utf8')) as Template);
    await application.templates.ensure(Object.keys(index));
    const document = (await fixture.get('/')).body;
    const parts = renderParts(application, decodeResponse(application, parseJson((await fixture.get('/', { Accept: 'application/json' })).body), '/'));
    expect(document).toContain(`<title>${parts.title}</title>`);
    expect(document).toContain(`<aside id="side">${parts.regions.get('side')}</aside>`);
    expect(parts.regions.get('content')).toBe('<p>Home|n0</p>\n');
    expect(document).toContain('<main id="content"><p>Home|n0</p>\n</main>');
  });

  it('embeds the document JSON in the document (HY-31)', async () => {
    const html = (await fixture.get('/list')).body;
    const body = (await fixture.get('/list', { Accept: 'application/json' })).body;
    const found = /<script type="application\/json" id="hy-data">(.*)<\/script>/.exec(html)?.[1];
    expect(JSON.parse(found!)).toEqual(JSON.parse(body));
    expect(found).toContain('"a\\u003c"');
  });

  it('puts route regions right after the page region (HY-30)', async () => {
    const region = json(await fixture.get('/list', JSON_REGION));
    const document = json(await fixture.get('/list', { Accept: 'application/json' }));
    expect(Object.keys(region.regions)).toEqual(['content', 'rows']);
    expect(Object.keys(document.regions)).toEqual(['side', 'content', 'rows']);
    expect(region.regions.rows).toEqual({ items: ['a<', 'b0'], open: false, mode: 'a', view: 'x', filter: { a: 1 }, tags: [] });
    expect((await fixture.get('/list')).body).toContain('<ul id="rows"><li>a&lt;</li><li>b0</li></ul>');
  });

  it('passes route regions to the page region as HTML definitions (HY-13, HY-30)', async () => {
    expect((await fixture.get('/list')).body).toContain('<main id="content"><h1>List</h1><ul id="rows"><li>a&lt;</li><li>b0</li></ul>\n</main>');
  });

  it('requires a route region loader to be declared (HY-30)', async () => {
    await expect(App.open({ manifest: `${FIXTURES}app.json`, templates: TEMPLATES, timezone: 'Z', handlers: {
      routes: { add: { post: () => Result.redirect('/') }, home: { regions: { rows: () => ({}) } } },
    } })).rejects.toThrow('undeclared region rows');
  });

  it('stores and applies a server kept value (HY-37, HY-38, HY-40)', async () => {
    const token = await fixture.token();
    expect((await fixture.keep({ _csrf: token, region: 'rows', path: 'open', value: 'true' })).status).toBe(204);
    const response = json(await fixture.get('/list', JSON_REGION));
    expect((response.regions.rows as Record<string, unknown>).open).toBe(false);
    expect(response.kept).toEqual({ rows: { open: true } });
    const document = (await fixture.get('/list')).body;
    expect(document).toContain('"rows":{"items":["a\\u003c","b0"],"open":false');
    expect(document).toContain('"kept":{"rows":{"open":true}}');
  });

  it('rejects invalid keep requests (HY-40)', async () => {
    const token = await fixture.token();
    expect((await fixture.keep({ _csrf: 'wrong', region: 'rows', path: 'open', value: 'true' })).status).toBe(403);
    expect((await fixture.keep({ _csrf: token, region: 'rows', path: 'mode', value: '"b"' })).status).toBe(400);
    expect((await fixture.keep({ _csrf: token, region: 'rows', path: 'view', value: '"y"' })).status).toBe(400);
    expect((await fixture.keep({ _csrf: token, region: 'missing', path: 'open', value: 'true' })).status).toBe(400);
    expect((await fixture.keep({ _csrf: token, region: 'rows', path: 'open', value: 'tru' })).status).toBe(400);
    expect((await fixture.keep({ _csrf: token, region: 'rows', path: 'constructor', value: 'true' })).status).toBe(400);
    expect((await fixture.keep({}, 'GET')).status).toBe(405);
    expect((json(await fixture.get('/list', JSON_REGION)).regions.rows as Record<string, unknown>).open).toBe(false);
    expect(json(await fixture.get('/list', JSON_REGION)).kept).toEqual({});
  });

  it('sends cookie kept values apart from the region data (HY-17, HY-37, HY-38)', async () => {
    const value = JSON.stringify({ rows: { mode: 'b', open: true, view: 'y' }, side: { count: 9 } });
    const response = json(await fixture.get('/list', { ...JSON_REGION, ...cookie('hy-keep', value) }));
    expect(response.regions.rows).toEqual({ items: ['a<', 'b0'], open: false, mode: 'a', view: 'x', filter: { a: 1 }, tags: [] });
    expect(response.kept).toEqual({ rows: { mode: 'b' } });
    for (const ignored of ['{"rows":{"mode":1}}', '{', '{"rows":{"filter":{"a":"s"}}}', '{"rows":{"filter":{"b":1}}}', '{"rows":{"filter":{}}}']) {
      expect(json(await fixture.get('/list', { ...JSON_REGION, ...cookie('hy-keep', ignored) })).kept, ignored).toEqual({});
    }
    expect(json(await fixture.get('/list', { ...JSON_REGION, ...cookie('hy-keep', '{"rows":{"filter":{"a":2}}}') })).kept).toEqual({ rows: { filter: { a: 2 } } });
  });

  it('renders a region whose kept values break rendering without them (HY-38)', async () => {
    const headers = cookie('hy-keep', '{"rows":{"mode":"b","tags":[1]}}');
    const document = await fixture.get('/list', headers);
    expect(document.status).toBe(200);
    expect(document.body).toContain('<li>a&lt;</li><li>b0</li>');
    expect(document.body).toContain('"kept":{}');
    expect(json(await fixture.get('/list', { ...JSON_REGION, ...headers })).kept).toEqual({ rows: { mode: 'b', tags: [1] } });
  });

  it('rejects manifests with invalid keep declarations (HY-37, HY-40)', async () => {
    for (const name of ['keep-kind', 'keep-page', 'keep-reserved', 'uses-topic']) {
      await expect(App.open({ manifest: `${FIXTURES}invalid/${name}.json`, templates: TEMPLATES, handlers: {}, timezone: 'Z' }), name).rejects.toThrow();
    }
  });

  it('rejects input that is not UTF-8 before loaders and actions (HY-42)', async () => {
    const token = await fixture.token();
    expect((await fixture.post('/add', `_csrf=${token}&name=bad%FF`)).status).toBe(400);
    expect(fixture.counter.actions).toBe(0);
    expect((await fixture.get('/?q=%C3')).status).toBe(400);
    expect((await fixture.get('/?a[%FF][x]=1')).status).toBe(400);
    expect((await fixture.get('/', { Cookie: 'hy-keep=%FF' })).status).toBe(200);
    expect((await fixture.get('/', { Cookie: 'PHPSESSID=%FF' })).status).toBe(200);
    expect((await fixture.get('/', { Cookie: 'unrelated=%FF' })).status).toBe(200);
    expect((await fixture.get('/', { 'HX-Current-URL': 'http://x/\xFF' })).status).toBe(400);
    expect((await fixture.get('/items/\xFF')).status).toBe(400);
    // A request target is ASCII (RFC 9112), so a raw UTF-8 path is rejected as well; a client encodes it.
    expect((await fixture.get(Buffer.from('/items/한').toString('latin1'))).status).toBe(400);
    expect((await fixture.get('/items/%ED%95%9C')).status).toBe(200);
  });

  it('gives a plain 500 for an unhandled error and logs it (HY-43)', async () => {
    for (const headers of [{}, JSON_REGION]) {
      const response = await fixture.get('/items/broken', headers);
      expect(response.status).toBe(500);
      expect(response.body).toBe('Internal Server Error');
    }
    expect(fixture.log[0]).toContain('secret detail /srv/app.js');
  });

  it('fails an integer outside the safe range for a document and for JSON (HY-44)', async () => {
    expect((await fixture.get('/items/huge')).status).toBe(500);
    expect((await fixture.get('/items/huge', JSON_REGION)).status).toBe(500);
  });

  it('keeps numeric data keys (HY-17)', async () => {
    expect((await fixture.get('/items/numeric', JSON_REGION)).body).toContain('"regions":{"content":{"5":"x","id":"n"}}');
  });

  it('rejects long kept values (HY-40)', async () => {
    const token = await fixture.token();
    expect((await fixture.keep({ _csrf: token, region: 'rows', path: 'open', value: JSON.stringify('a'.repeat(4095)) })).status).toBe(400);
  });

  it('ignores or rejects kept values outside the data model (HY-38, HY-40)', async () => {
    const token = await fixture.token();
    expect((await fixture.keep({ _csrf: token, region: 'rows', path: 'filter', value: '{"a":9007199254740993}' })).status).toBe(400);
    expect((await fixture.keep({ _csrf: token, region: 'rows', path: 'filter', value: '{"a":1e400}' })).status).toBe(400);
    for (const value of ['{"rows":{"filter":{"a":9007199254740993}}}', '{"rows":{"filter":{"a":1e400}}}']) {
      const response = await fixture.get('/list', { ...JSON_REGION, ...cookie('hy-keep', value) });
      expect(response.status).toBe(200);
      expect(response.body).toContain('"filter":{"a":1}');
      expect(response.body).toContain('"kept":{}');
    }
  });

  it('ignores only the cookie kept values outside the data model, as PHP json_decode reads them (HY-38)', async () => {
    const response = json(await fixture.get('/list', { ...JSON_REGION, ...cookie('hy-keep', '{"rows":{"filter":{"a":9007199254740993},"mode":"b"}}') }));
    expect(response.kept).toEqual({ rows: { mode: 'b' } });
  });

  it('limits framing in every response (HY-45)', async () => {
    for (const response of [await fixture.get('/'), await fixture.get('/missing'), await fixture.get('/items/broken'), await fixture.get('/', JSON_REGION)]) {
      expect(response.headers['Content-Security-Policy']).toBe("frame-ancestors 'self'");
    }
    const framed = await fixture.handle({ target: '/' }, { frameAncestors: "'self' https://admin.example" });
    expect(framed.headers['Content-Security-Policy']).toBe("frame-ancestors 'self' https://admin.example");
  });

  it('treats an empty kept map as a map (HY-38)', async () => {
    for (const value of ['{"rows":{"filter":{}}}', '{"rows":{"filter":[]}}']) {
      expect((await fixture.get('/list', { ...JSON_REGION, ...cookie('hy-keep', value) })).body).toContain('"kept":{}');
    }
  });

  it('returns the protocol shape for a region request (HY-17, HY-18)', async () => {
    const response = await fixture.get('/items/a%20b', JSON_REGION);
    expect(response.status).toBe(200);
    expect(response.headers['Content-Type']).toBe('application/json; charset=utf-8');
    const token = fixture.session.get('_hyper_csrf') as string;
    expect(response.body).toBe(`{"env":{"timezone":"+09:00"},"route":"item","params":{"id":"a b"},"shared":{"title":"Item","csrf":"${token}"},"regions":{"content":{"id":"a b"}},"kept":{}}`);
  });

  it('returns every region in manifest order for a document request (HY-15, HY-18)', async () => {
    const response = json(await fixture.get('/', { Accept: 'application/json' }));
    expect(response.route).toBe('home');
    expect(Object.keys(response.regions)).toEqual(['side', 'content']);
  });

  it('writes empty maps as JSON objects (HY-17)', async () => {
    expect((await fixture.get('/', JSON_REGION)).body).toContain('"params":{}');
  });

  it('adds the regions that use path after navigation (HY-11, HY-19)', async () => {
    const same = json(await fixture.get('/', { ...JSON_REGION, 'HX-Current-URL': 'http://localhost/?page=2' }));
    const other = json(await fixture.get('/', { ...JSON_REGION, 'HX-Current-URL': 'http://localhost/add' }));
    expect(Object.keys(same.regions)).toEqual(['content']);
    expect(Object.keys(other.regions)).toEqual(['content', 'side']);
    expect(other.regions.side).toEqual({ count: 0, note: null });
  });

  it('treats an htmx JSON request as a region request and other JSON as a document request (HY-15, HY-18)', async () => {
    expect(Object.keys(json(await fixture.get('/', JSON_REGION)).regions)).toEqual(['content']);
    expect(Object.keys(json(await fixture.get('/', { Accept: 'application/json' })).regions)).toEqual(['side', 'content']);
    expect((await fixture.get('/', JSON_REGION)).headers.Vary).toBe('Accept, HX-Request, HX-Current-URL');
  });

  it('reads only the host-only kept cookie on HTTPS (HY-39, HY-45)', async () => {
    const options = { https: true, handlers: { routes: { add: { post: () => Result.redirect('/') }, list: { regions: { rows: () => ({ items: [], mode: 'a' }) } } } } };
    const read = async (headers: Record<string, string>) => json(await fixture.handle({ target: '/list', headers: { ...JSON_REGION, ...headers } }, options)).kept;
    expect(await read(cookie('__Host-hy-keep', '{"rows":{"mode":"b"}}'))).toEqual({ rows: { mode: 'b' } });
    expect(await read(cookie('hy-keep', '{"rows":{"mode":"b"}}'))).toEqual({});
    expect(json(await fixture.get('/list', { ...JSON_REGION, ...cookie('__Host-hy-keep', '{"rows":{"mode":"b"}}') })).kept).toEqual({});
  });

  it('removes the base path for routing and adds it to redirects (HY-8, HY-11)', async () => {
    const routed = json(await fixture.get('/api/items/7', { ...JSON_REGION, 'HX-Current-URL': 'http://localhost/items/7' }, '/api'));
    expect(Object.keys(routed.regions)).toEqual(['content']);
    expect((await fixture.get('/items/7', {}, '/api')).status).toBe(404);
    const token = await fixture.token();
    const redirect = await fixture.post('/api/add', { _csrf: token, name: 'a' }, JSON_REGION, '/api');
    expect(redirect.status).toBe(303);
    expect(redirect.headers.Location).toBe('/api/');
  });

  it('rejects an action without the token (HY-24)', async () => {
    await fixture.token();
    expect((await fixture.post('/add', { _csrf: 'wrong', name: 'a' })).status).toBe(403);
    expect(fixture.counter.actions).toBe(0);
  });

  it('redirects after a successful action and passes flash values and topics once (HY-25)', async () => {
    const response = await fixture.post('/add', { _csrf: await fixture.token(), name: 'a' }, JSON_REGION);
    expect(response.status).toBe(303);
    expect(response.headers.Location).toBe('/');
    const next = json(await fixture.get('/', JSON_REGION));
    expect(Object.keys(next.regions)).toEqual(['content', 'side']);
    expect(next.regions.side).toEqual({ count: 1, note: 'added' });
    expect(next.regions.content).toEqual({ name: 'n1' });
    expect(Object.keys(json(await fixture.get('/', JSON_REGION)).regions)).toEqual(['content']);
  });

  it('renders the page with status 422 for a rejected action (HY-26)', async () => {
    const token = await fixture.token();
    const jsonResponse = await fixture.post('/add', { _csrf: token, name: '' }, JSON_REGION);
    const html = await fixture.post('/add', { _csrf: token, name: '' });
    expect(jsonResponse.status).toBe(422);
    expect(json(jsonResponse).regions.content).toEqual({ name: '', error: 'empty' });
    expect(html.status).toBe(422);
    expect(html.body).toContain('<p>Add| !empty</p>');
    expect(fixture.counter.count).toBe(0);
  });

  it('fails unknown paths, missing resources and other methods (HY-27)', async () => {
    expect((await fixture.get('/missing')).status).toBe(404);
    expect((await fixture.get('/items/missing')).status).toBe(404);
    expect((await fixture.post('/', {})).status).toBe(405);
    expect((await fixture.handle({ method: 'DELETE', target: '/add' })).status).toBe(405);
  });

  it('answers a loader redirect with 303 and passes its flash values (HY-50)', async () => {
    const response = await fixture.get('/items/moved', JSON_REGION);
    expect(response.status).toBe(303);
    expect(response.headers.Location).toBe('/items/new');
    expect(response.body).toBe('');
    expect((json(await fixture.get('/', { Accept: 'application/json' })).regions.side as Record<string, unknown>).note).toBe('moved');
    expect((await fixture.get('/api/items/moved', {}, '/api')).headers.Location).toBe('/api/items/new');
  });

  it('answers a forbidden loader and action with 403 (HY-51)', async () => {
    const page = await fixture.get('/items/private');
    expect(page.status).toBe(403);
    expect(page.body).toBe('Forbidden');
    const action = await fixture.post('/add', { _csrf: await fixture.token(), name: 'closed' });
    expect(action.status).toBe(403);
    expect(fixture.counter.count).toBe(0);
  });

  it('checks the body limit, the media type and the token in this order (HY-59)', async () => {
    const token = await fixture.token();
    const limit = { bodyLimit: 64 };
    const form = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const text = { 'Content-Type': 'text/plain' };
    const large = `_csrf=wrong&name=${'a'.repeat(48)}`;
    expect(large.length).toBe(65);
    const send = (method: string, target: string, headers: Record<string, string>, body: string, options: { bodyLimit?: number }) => fixture.handle({ method, target, headers, body }, options);
    const tooLarge = await send('POST', '/add', text, large, limit);
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body).toBe('Content Too Large');
    expect((await send('GET', '/', text, large, limit)).status).toBe(413);
    expect((await send('POST', '/_hyper/keep', text, large, limit)).status).toBe(413);
    expect((await send('POST', '/add', { ...form, 'Content-Length': '65' }, '', limit)).status).toBe(413);
    expect((await send('POST', '/add', text, '_csrf=wrong&name=a', limit)).status).toBe(415);
    const unsupported = await send('POST', '/add', { 'Content-Type': 'multipart/form-data; boundary=x' }, `--x\r\nContent-Disposition: form-data; name="_csrf"\r\n\r\n${token}\r\n--x--\r\n`, {});
    expect(unsupported.status).toBe(415);
    expect(unsupported.body).toBe('Unsupported Media Type');
    expect((await send('POST', '/_hyper/keep', { 'Content-Type': '' }, '_csrf=wrong', {})).status).toBe(415);
    expect((await send('POST', '/add', form, `_csrf=wrong&name=${'a'.repeat(47)}`, limit)).status).toBe(403);
    expect(fixture.counter.actions).toBe(0);
    expect((await send('POST', '/add', { 'Content-Type': 'Application/X-WWW-Form-Urlencoded; charset=UTF-8' }, `_csrf=${token}&name=a`, {})).status).toBe(303);
  });

  it('takes the accepted form types as an option (HY-59)', async () => {
    const token = await fixture.token();
    const body = `--x\r\nContent-Disposition: form-data; name="_csrf"\r\n\r\n${token}\r\n--x\r\nContent-Disposition: form-data; name="name"\r\n\r\na\r\n--x--\r\n`;
    const multipart = { 'Content-Type': 'multipart/form-data; boundary=x' };
    expect((await fixture.handle({ method: 'POST', target: '/add', headers: multipart, body }, { formTypes: ['application/x-www-form-urlencoded', 'multipart/form-data'] })).status).toBe(303);
    expect((await fixture.post('/add', { _csrf: token, name: 'a' }, {}, '')).status).toBe(303);
    expect((await fixture.handle({ method: 'POST', target: '/add', body: `_csrf=${token}&name=a` }, { formTypes: ['multipart/form-data'] })).status).toBe(415);
    for (const options of [{ formTypes: [] }, { formTypes: ['text/plain'] }, { formTypes: ['multipart/form-data', 'multipart/form-data'] }, { bodyLimit: 0 }, { bodyLimit: 1.5 }]) {
      await expect(fixture.app(options)).rejects.toThrow('hyper:');
    }
  });

  it('reports every response once with the request and the elapsed time (HY-60)', async () => {
    const reports: [string, string, number, unknown, number][] = [];
    const options = {
      bodyLimit: 256,
      onResponse: (request: Request | null, response: Response, elapsed: number) => {
        reports.push([request!.method, request!.path(), response.status, response.headers['Content-Security-Policy'], elapsed]);
      },
    };
    const token = await fixture.token();
    const form = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const send = (method: string, target: string, headers: Record<string, string>, body: string | undefined, extra: { basePath?: string } = {}) => fixture.handle({ method, target, headers, body }, { ...options, ...extra });
    await send('GET', '/api/', {}, undefined, { basePath: '/api' });
    await send('GET', '/', {}, undefined);
    await send('GET', '/?q=%FF', {}, undefined);
    await send('POST', '/add', form, '_csrf=wrong');
    await send('GET', '/missing', {}, undefined);
    await send('POST', '/', form, '');
    await send('POST', '/add', form, 'a'.repeat(257));
    await send('POST', '/add', { 'Content-Type': 'text/plain' }, '');
    await send('GET', '/items/broken', {}, undefined);
    await send('POST', '/add', form, `_csrf=${token}&name=a`);
    expect(reports.map((report) => report.slice(0, 3))).toEqual([
      ['GET', '/api/', 200], ['GET', '/', 200], ['GET', '/', 400], ['POST', '/add', 403], ['GET', '/missing', 404],
      ['POST', '/', 405], ['POST', '/add', 413], ['POST', '/add', 415], ['GET', '/items/broken', 500], ['POST', '/add', 303],
    ]);
    for (const report of reports) {
      expect(report[3]).toBe("frame-ancestors 'self'");
      expect(report[4]).toBeGreaterThanOrEqual(0);
    }

    // The elapsed time counts from the start that the caller gives, such as the time when the server received it.
    reports.length = 0;
    await (await fixture.app(options)).handle(Request.from({ method: 'GET', target: '/' }), fixture.session, performance.now() - 2000);
    expect(reports[0]![4]).toBeGreaterThanOrEqual(2000);
  });

  it('gives the hook the reply of the request with the notes of its loaders and actions (HY-60)', async () => {
    const reports: [number, Record<string, unknown>][] = [];
    const options = { onResponse: (_request: Request | null, response: Response, _elapsed: number, reply: Reply) => reports.push([response.status, Object.fromEntries(reply.notes())]) };
    const token = await fixture.token();
    const send = (method: string, target: string, body?: string) => fixture.handle({ method, target, body }, options);
    const forbidden = await send('GET', '/items/private');
    await send('POST', '/add', `_csrf=${token}&name=closed`);
    await send('GET', '/items/broken');
    await send('GET', '/items/member');
    await send('GET', '/missing');
    await send('GET', '/?q=%FF');
    expect(reports).toEqual([
      [403, { refusal: 'private' }], [403, { refusal: 'closed', kind: 'closed' }], [500, { stage: 'load' }], [200, {}], [404, {}], [400, {}],
    ]);
    expect(Object.keys((reports[1]![1]))).toEqual(['refusal', 'kind']);
    expect(forbidden.headers).toEqual({ 'Content-Type': 'text/plain; charset=utf-8', 'Content-Security-Policy': "frame-ancestors 'self'", 'Cache-Control': 'no-store' });
  });

  it('marks every failure as not cacheable (HY-65)', async () => {
    const token = await fixture.token();
    const form = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const send = (method: string, target: string, headers: Record<string, string>, body: string | undefined, options: { bodyLimit?: number } = {}) => fixture.handle({ method, target, headers, body }, options);
    const responses = [
      await send('GET', '/?q=%FF', {}, undefined),
      await fixture.get('/items/unreadable', JSON_REGION),
      await send('POST', '/add', form, '_csrf=wrong'),
      await fixture.get('/items/private'),
      await fixture.get('/missing'),
      await fixture.get('/items/missing', JSON_REGION),
      await send('PUT', '/', {}, undefined),
      await send('POST', '/add', form, 'a'.repeat(65), { bodyLimit: 64 }),
      await send('POST', '/add', { 'Content-Type': 'text/plain' }, ''),
      await fixture.post('/_hyper/keep', { _csrf: token, region: 'side', path: 'x', value: '1' }),
      await fixture.get('/items/broken'),
      await fixture.post('/add', { _csrf: token, name: 'taken' }, JSON_REGION),
      await fixture.post('/add', { _csrf: token, name: '' }, JSON_REGION),
    ];
    expect(responses.map((response) => response.status)).toEqual([400, 400, 403, 403, 404, 404, 405, 413, 415, 400, 500, 409, 422]);
    for (const response of responses) expect([response.status, response.headers['Cache-Control']]).toEqual([response.status, 'no-store']);
    expect((await fixture.get('/items/member')).headers['Cache-Control']).toBe('public, max-age=60');
  });

  it('does not send a response larger than the response limit (HY-66)', async () => {
    const reports: [number, Record<string, unknown>][] = [];
    const options = { responseLimit: 64, onResponse: (_request: Request | null, response: Response, _elapsed: number, reply: Reply) => reports.push([response.status, Object.fromEntries(reply.notes())]) };
    const document = await fixture.handle({ target: '/' }, options);
    const region = await fixture.handle({ target: '/items/7', headers: JSON_REGION }, options);
    for (const response of [document, region]) {
      expect(response.status).toBe(500);
      expect(response.body).toBe('Internal Server Error');
      expect(response.headers['Cache-Control']).toBe('no-store');
      expect(response.headers['Content-Type']).toBe('text/plain; charset=utf-8');
    }
    expect((await fixture.handle({ target: '/' }, { responseLimit: 1 << 20 })).status).toBe(200);
    expect(fixture.log[0]).toMatch(/^hyper: the response to GET \/ has \d+ bytes, more than the response limit of 64 bytes$/);
    expect(fixture.log[1]).toMatch(/^hyper: the response to GET \/items\/7 has \d+ bytes, more than the response limit of 64 bytes$/);
    expect(reports).toEqual([[500, {}], [500, {}]]);
    for (const responseLimit of [0, -1, 1.5]) await expect(fixture.app({ responseLimit })).rejects.toThrow('hyper:');
  });

  it('answers a bad request loader and action with 400 (HY-58)', async () => {
    const page = await fixture.get('/items/unreadable', JSON_REGION);
    expect(page.status).toBe(400);
    expect(page.body).toBe('Bad Request');
    expect(page.headers['Content-Type']).toBe('text/plain; charset=utf-8');
    const action = await fixture.post('/add', { _csrf: await fixture.token(), name: 'unreadable' });
    expect(action.status).toBe(400);
    expect(fixture.counter.count).toBe(0);
  });

  it('renders the page with the status of an action result (HY-58)', async () => {
    const token = await fixture.token();
    const conflict = await fixture.post('/add', { _csrf: token, name: 'taken' }, JSON_REGION);
    expect(conflict.status).toBe(409);
    expect(json(conflict).regions.content).toEqual({ name: 'taken', error: 'conflict' });
    expect(conflict.headers['Cache-Control']).toBe('no-store');
    const document = await fixture.post('/add', { _csrf: token, name: 'taken' });
    expect(document.status).toBe(409);
    expect(document.body).toContain('<p>Add|taken !conflict</p>');

    const preview = await fixture.post('/add', { _csrf: token, name: 'preview' }, { Accept: 'application/json' });
    expect(preview.status).toBe(200);
    expect((json(preview).regions.content as Record<string, unknown>).name).toBe('preview');
    // HY-53: only a GET request receives 304; an action runs whatever tag the request names.
    const again = await fixture.post('/add', { _csrf: token, name: 'preview' }, { Accept: 'application/json', 'If-None-Match': preview.headers.ETag as string });
    expect(again.status).toBe(200);
    expect(again.body).toBe(preview.body);
    expect((await fixture.post('/add', { _csrf: token, name: 'preview' })).status).toBe(200);
    expect(fixture.counter.count).toBe(0);
  });

  it('accepts an action result status of 200, 409 or 422 only (HY-58)', () => {
    expect(Result.invalid({}).status).toBe(422);
    for (const status of [201, 303, 400, 404, 500]) expect(() => Result.page(status, {})).toThrow('status');
  });

  it('puts the reply cookies and cache control into the response (HY-52)', async () => {
    const page = await fixture.get('/items/member');
    expect(page.status).toBe(200);
    expect(page.headers['Set-Cookie']).toEqual([
      'member=token.1; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600',
      'old=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    ]);
    expect(page.headers['Cache-Control']).toBe('public, max-age=60');
    const https = await fixture.handle({ target: '/items/member', https: true });
    expect((https.headers['Set-Cookie'] as string[])[0]).toBe('member=token.1; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=3600');
    const forbidden = await fixture.get('/items/guarded');
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers['Set-Cookie']).toEqual(['member=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0']);
    expect((await fixture.get('/items/bad-cookie')).status).toBe(500);
    expect((await fixture.get('/items/plain')).headers['Set-Cookie']).toBeUndefined();
  });

  it('does not let page responses be stored unless the reply sets Cache-Control (HY-52)', async () => {
    expect((await fixture.get('/items/plain')).headers['Cache-Control']).toBe('no-store');
    expect((await fixture.get('/items/plain', JSON_REGION)).headers['Cache-Control']).toBe('no-store');
    const token = await fixture.token();
    expect((await fixture.post('/add', { _csrf: token, name: '' })).headers['Cache-Control']).toBe('no-store');
    expect((await fixture.get('/items/member', JSON_REGION)).headers['Cache-Control']).toBe('public, max-age=60');
  });

  it('tags JSON responses and answers a matching request with 304 (HY-53)', async () => {
    const first = await fixture.get('/items/plain', { Accept: 'application/json' });
    const tag = first.headers.ETag as string;
    expect(tag).toBe(`"${createHash('sha256').update(first.body).digest('hex').slice(0, 32)}"`);
    const again = await fixture.get('/items/plain', { Accept: 'application/json', 'If-None-Match': tag });
    expect(again.status).toBe(304);
    expect(again.body).toBe('');
    expect(again.headers.ETag).toBe(tag);
    expect((await fixture.get('/items/plain', { Accept: 'application/json', 'If-None-Match': '"other"' })).status).toBe(200);
  });

  it('requires the handlers to match the manifest (HY-2)', async () => {
    await expect(App.open({ manifest: `${FIXTURES}app.json`, templates: TEMPLATES, timezone: 'Z', handlers: { routes: { unknown: {} } } })).rejects.toThrow('no route');
  });

  it('requires an action for a declared POST route (HY-2)', async () => {
    await expect(App.open({ manifest: `${FIXTURES}app.json`, templates: TEMPLATES, timezone: 'Z', handlers: {} })).rejects.toThrow('no POST action');
  });
});

describe('Node handlers', () => {
  it('passes one context with the request, the reply and the services (HY-54)', async () => {
    const seen: unknown[] = [];
    const base = handlers();
    const app = await fixture.app({ handlers: { ...base, shared: (context) => {
      seen.push(Object.keys(context).sort(), context.services.get('counter') === fixture.counter);
      return { site: 'x' };
    } } });
    const response = json(await app.handle((await import('../src/index.js')).Request.from({ method: 'GET', target: '/', headers: JSON_REGION }), fixture.session));
    expect(seen).toEqual([['reply', 'request', 'services'], true]);
    expect(response.shared).toEqual({ title: 'Home', csrf: fixture.session.get('_hyper_csrf'), site: 'x' });
  });

  it('fails data that is not a value of the data model (HY-44)', async () => {
    class Point {
      x = 1;
    }
    for (const value of [new Point(), '\uD800', Number.NaN, 1e20, 2 ** 53, () => 1]) {
      const app = await fixture.app({ handlers: { ...handlers(), routes: { ...handlers().routes, home: { load: () => ({ value }) } } } });
      const request = (await import('../src/index.js')).Request.from({ method: 'GET', target: '/', headers: JSON_REGION });
      expect((await app.handle(request, fixture.session)).status, String(value)).toBe(500);
    }
  });

  it('fails a service without a factory with 500 (HY-43)', async () => {
    const app = await App.open<{ counter: { count: number } }>({ manifest: `${FIXTURES}app.json`, templates: TEMPLATES, timezone: 'Z', log: () => {}, handlers: {
      routes: { add: { post: () => Result.redirect('/') }, home: { load: ({ services }) => ({ name: services.get('counter').count }) } },
    } });
    const request = (await import('../src/index.js')).Request.from({ method: 'GET', target: '/' });
    expect((await app.handle(request, fixture.session)).status).toBe(500);
  });

  it('requires absolute paths and a template for every route (HY-34, HY-54)', async () => {
    await expect(App.open({ manifest: 'app.json', templates: TEMPLATES, timezone: 'Z', handlers: {} })).rejects.toThrow('absolute');
    await expect(App.open({ manifest: `${FIXTURES}app.json`, templates: { index: `${FIXTURES}app.json`, root: TEMPLATES.root }, timezone: 'Z', handlers: { routes: { add: { post: () => Result.redirect('/') } } } })).rejects.toThrow('template index');
  });
});
