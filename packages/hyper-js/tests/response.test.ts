import { describe, expect, it } from 'vitest';
import { parseJson } from '@polyspec/template';
import { renderDocument, toHtml } from '../src/index.js';
import { testApplication } from './application.js';

const app = testApplication();

function response(route: string, regions: string, shared = '{"title":"T","shared_only":"s"}', timezone = 'Z'): ReturnType<typeof parseJson> {
  return parseJson(`{"env":{"timezone":"${timezone}"},"route":"${route}","params":{},"shared":${shared},"regions":${regions}}`);
}

describe('toHtml', () => {
  it('renders the title, the page region and partials in response order (HY-21)', () => {
    const html = toHtml(app, response('home', '{"side":{"count":3},"content":{"name":"n"}}'), '/');
    expect(html).toBe('<title>T - Site</title><p>T|n|s</p><hx-partial hx-target="#side" hx-swap="innerMorph"><b>3</b></hx-partial>');
  });

  it('lets region data replace shared data with the same name (HY-13)', () => {
    const html = toHtml(app, response('home', '{"content":{"title":"region","name":"n"}}'), '/');
    expect(html).toBe('<title>T - Site</title><p>region|n|s</p>');
  });

  it('escapes the title through the title template', () => {
    const html = toHtml(app, response('home', '{"content":{}}', '{"title":"a<b>&"}'), '/');
    expect(html).toBe('<title>a&lt;b&gt;&amp; - Site</title><p>a&lt;b&gt;&amp;||</p>');
  });

  it('renders with the time zone of the response (HY-14)', () => {
    const html = toHtml(app, response('when', '{"content":{"at":0}}', '{"title":"T"}', '+09:00'), '/when');
    expect(html).toBe('<title>T - Site</title>1970-01-01 09:00');
  });

  it('selects the page template with the browser router (HY-20)', () => {
    expect(toHtml(app, response('item', '{"content":{"id":"7"}}'), '/items/7')).toBe('<title>T - Site</title><i>7</i>');
  });

  it('fails when the browser route differs from the server route (HY-20)', () => {
    expect(() => toHtml(app, response('home', '{"content":{}}'), '/items/7')).toThrow('differs from server route');
    expect(() => toHtml(app, response('home', '{"content":{}}'), '/missing')).toThrow('differs from server route');
  });

  it('fails for a region that the manifest does not declare', () => {
    expect(() => toHtml(app, response('home', '{"content":{},"other":{}}'), '/')).toThrow('not in the manifest');
  });

  it('fails when the page region is missing', () => {
    expect(() => toHtml(app, response('home', '{"side":{"count":1}}'), '/')).toThrow('no region content');
  });
});

describe('renderDocument', () => {
  it('renders the layout with the title and every region (HY-12)', () => {
    const html = renderDocument(app, response('home', '{"side":{"count":2},"content":{"name":"n"}}'), '/');
    expect(html).toBe('<title>T - Site</title>\n<aside id="side" hy-region><b>2</b></aside>\n<main id="content" hy-region><p>T|n|s</p></main>\n');
  });

  it('fails when a region is missing', () => {
    expect(() => renderDocument(app, response('home', '{"content":{"name":"n"}}'), '/')).toThrow('no region side');
  });
});
