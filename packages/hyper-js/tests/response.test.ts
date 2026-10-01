import { describe, expect, it } from 'vitest';
import { parseJson } from '@polyspec/template';
import { decodeResponse, renderDocument, renderParts, toHtml } from '../src/index.js';
import { loadedApplication } from './application.js';

const app = await loadedApplication();

function response(route: string, regions: string, shared = '{"title":"T","shared_only":"s"}', timezone = 'Z', kept = '{}'): ReturnType<typeof parseJson> {
  return parseJson(`{"env":{"timezone":"${timezone}"},"route":"${route}","params":{},"shared":${shared},"regions":${regions},"kept":${kept}}`);
}

describe('toHtml', () => {
  it('renders the title, the page region and partials in response order (HY-21)', () => {
    const html = toHtml(app, decodeResponse(app, response('home', '{"side":{"count":3},"content":{"name":"n"}}'), '/'));
    expect(html).toBe('<title>T - Site</title><p>T|n|s</p><hx-partial hx-target="#side" hx-swap="innerMorph"><b>3</b></hx-partial>');
  });

  it('lets region data replace shared data with the same name (HY-13)', () => {
    const html = toHtml(app, decodeResponse(app, response('home', '{"content":{"title":"region","name":"n"}}'), '/'));
    expect(html).toBe('<title>T - Site</title><p>region|n|s</p>');
  });

  it('renders with the time zone of the response (HY-14)', () => {
    const html = toHtml(app, decodeResponse(app, response('when', '{"content":{"at":0}}', '{"title":"T"}', '+09:00'), '/when'));
    expect(html).toBe('<title>T - Site</title>1970-01-01 09:00');
  });

  it('renders route regions inside the page region, not as partials (HY-30)', () => {
    const html = toHtml(app, decodeResponse(app, response('list', '{"content":{"heading":"H"},"rows":{"items":[{"name":"a","open":true},{"name":"b"}]}}'), '/list'));
    expect(html).toBe('<title>T - Site</title><h1>H</h1><ul id="rows"><li class="open">a</li><li>b</li></ul>');
  });

  it('fails when the browser route differs from the server route (HY-20)', () => {
    expect(() => decodeResponse(app, response('home', '{"content":{}}'), '/items/7')).toThrow('differs from server route');
    expect(() => decodeResponse(app, response('home', '{"content":{}}'), '/missing')).toThrow('differs from server route');
  });

  it('fails for a region that neither the manifest nor the route declares', () => {
    expect(() => toHtml(app, decodeResponse(app, response('home', '{"content":{},"other":{}}'), '/'))).toThrow('is not in the manifest');
  });
});

describe('renderDocument', () => {
  it('renders the layout with the title, every region and the embedded data (HY-12, HY-31)', () => {
    const value = response('list', '{"side":{"count":2},"content":{"heading":"H"},"rows":{"items":[{"name":"<a>"}]}}');
    const html = renderDocument(app, decodeResponse(app, value, '/list'));
    expect(html).toBe(
      '<title>T - Site</title>\n<aside id="side"><b>2</b></aside>\n<main id="content"><h1>H</h1><ul id="rows"><li>&lt;a&gt;</li></ul></main>\n'
      + '<script type="application/json" id="hy-data">{"env":{"timezone":"Z"},"route":"list","params":{},"shared":{"title":"T","shared_only":"s"},'
      + '"regions":{"side":{"count":2},"content":{"heading":"H"},"rows":{"items":[{"name":"\\u003ca\\u003e"}]}},"kept":{}}</script>',
    );
  });

  it('renders each part alone as it appears in the document (HY-13)', () => {
    const decoded = decodeResponse(app, response('list', '{"side":{"count":2},"content":{"heading":"H"},"rows":{"items":[]}}'), '/list');
    const document = renderDocument(app, decoded);
    for (const [name, html] of renderParts(app, decoded).regions) expect(document).toContain(`id="${name}">${html}</`);
  });

  it('fails when a region is missing', () => {
    expect(() => renderDocument(app, decodeResponse(app, response('home', '{"content":{"name":"n"}}'), '/'))).toThrow('no region side');
  });
});

describe('kept values of a response', () => {
  const regions = '{"side":{"count":2},"content":{"heading":"H"},"rows":{"items":[{"name":"a","open":false}],"flag":false,"tab":"a","tags":[]}}';

  it('applies the server and cookie kept values and embeds the loader data with them (HY-17, HY-31, HY-38)', () => {
    const decoded = decodeResponse(app, response('list', regions, undefined, undefined, '{"rows":{"items.0.open":true,"tab":"b"}}'), '/list');
    expect((decoded.regions.get('rows') as Map<string, unknown>).get('tab')).toBe('a');
    const html = renderDocument(app, decoded);
    expect(html).toContain('<li class="open">a</li>');
    expect(html).toContain('"rows":{"items":[{"name":"a","open":false}],"flag":false,"tab":"a","tags":[]}},"kept":{"rows":{"items.0.open":true,"tab":"b"}}}');
  });

  it('renders a region without its kept values when they break rendering (HY-38)', () => {
    const kept = '{"rows":{"items.0.open":true,"tags":[1]}}';
    const html = renderDocument(app, decodeResponse(app, response('list', regions, undefined, undefined, kept), '/list'));
    expect(html).toContain('<ul id="rows"><li>a</li></ul>');
    expect(html).toContain('"tags":[]}},"kept":{}}');

    const decoded = decodeResponse(app, response('list', regions, undefined, undefined, kept), '/list');
    expect(toHtml(app, decoded)).toContain('<ul id="rows"><li>a</li></ul>');
    expect((decoded.regions.get('rows') as Map<string, unknown>).get('tags')).toEqual([]);
  });

  it('fails when a region does not render with its loader data either', () => {
    const broken = '{"side":{"count":2},"content":{"heading":"H"},"rows":{"items":[],"tags":[1]}}';
    expect(() => renderDocument(app, decodeResponse(app, response('list', broken, undefined, undefined, '{"rows":{"flag":true}}'), '/list'))).toThrow();
  });
});

describe('route regions', () => {
  it('render alone without the page region data, in region parts and in documents (HY-13)', () => {
    const regions = '{"side":{"count":1},"content":{"heading":"H"},"inner":{}}';
    expect(toHtml(app, decodeResponse(app, response('leak', regions), '/leak'))).toContain('<div id="inner">[]</div>');
    expect(renderDocument(app, decodeResponse(app, response('leak', regions), '/leak'))).toContain('<div id="inner">[]</div>');
  });
});
