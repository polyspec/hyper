import { describe, expect, it } from 'vitest';
import { hyperExtension, type RequestContext } from '../src/index.js';
import { testApplication } from './application.js';

const app = testApplication();
const json = '{"env":{"timezone":"Z"},"route":"item","params":{"id":"7"},"shared":{"title":"T"},"regions":{"content":{"id":"7"}}}';

function element(id: string, attributes: string[]): { id: string; hasAttribute(name: string): boolean } {
  return { id, hasAttribute: (name) => attributes.includes(name) };
}

function context(target: unknown, action = '/items/7'): RequestContext {
  return { target, request: { action, headers: { Accept: 'text/html' } } };
}

function respond(ctx: RequestContext, type: string, text: string, url = ''): void {
  ctx.response = { raw: { url }, headers: { get: (name) => (name === 'content-type' ? type : null) } };
  ctx.text = text;
}

describe('hyperExtension for server-side rendering', () => {
  const extension = hyperExtension(app, { basePath: '' });

  it('requests JSON for a region target (HY-21)', () => {
    const ctx = context(element('content', ['hy-region']));
    extension.htmx_config_request(null, { ctx });
    expect(ctx.request).toEqual({ action: '/items/7', headers: { Accept: 'application/json', 'Hy-Region': 'content' } });
  });

  it('keeps HTML for a target without hy-region', () => {
    const ctx = context(element('', []));
    extension.htmx_config_request(null, { ctx });
    expect(ctx.request.headers).toEqual({ Accept: 'text/html' });
  });

  it('routes the final response URL and replaces the JSON with HTML (HY-20, HY-21)', () => {
    const ctx = context(element('content', ['hy-region']), '/old');
    extension.htmx_config_request(null, { ctx });
    respond(ctx, 'application/json; charset=utf-8', json, 'http://localhost/items/7');
    extension.htmx_after_request(null, { ctx });
    expect(ctx.text).toBe('<title>T - Site</title><i>7</i>');
  });

  it('passes a non-JSON response unchanged', () => {
    const ctx = context(element('content', ['hy-region']));
    extension.htmx_config_request(null, { ctx });
    respond(ctx, 'text/plain', 'Not Found', 'http://localhost/items/7');
    extension.htmx_after_request(null, { ctx });
    expect(ctx.text).toBe('Not Found');
  });

  it('throws from the response hook when rendering fails (HY-28)', () => {
    const ctx = context(element('content', ['hy-region']));
    extension.htmx_config_request(null, { ctx });
    respond(ctx, 'application/json', json, 'http://localhost/');
    expect(() => extension.htmx_after_request(null, { ctx })).toThrow('differs from server route');
  });

  it('keeps htmx history restoration', () => {
    expect(extension.htmx_before_history_restore(null, { path: '/' })).toBe(true);
  });
});

describe('hyperExtension for client-side rendering', () => {
  const restored: string[] = [];
  const extension = hyperExtension(app, { basePath: '/api', restore: (path) => restored.push(path) });

  it('prefixes same-origin region requests with the base path (HY-23)', () => {
    const ctx = context(element('content', ['hy-region']), '/items/7?x=1');
    extension.htmx_config_request(null, { ctx });
    expect(ctx.request.action).toBe('/api/items/7?x=1');
  });

  it('routes the response URL without the base path', () => {
    const ctx = context(element('content', ['hy-region']));
    extension.htmx_config_request(null, { ctx });
    respond(ctx, 'application/json', json, 'http://localhost/api/items/7');
    extension.htmx_after_request(null, { ctx });
    expect(ctx.text).toBe('<title>T - Site</title><i>7</i>');
  });

  it('removes the base path from history paths (HY-23)', () => {
    const detail = { history: { type: 'push', path: '/api/items/7?x=1' } };
    extension.htmx_before_history_update(null, detail);
    expect(detail.history.path).toBe('/items/7?x=1');
  });

  it('replaces htmx history restoration (HY-23)', () => {
    expect(extension.htmx_before_history_restore(null, { path: '/items/7' })).toBe(false);
    expect(restored).toEqual(['/items/7']);
  });
});
