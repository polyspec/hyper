// The token of a page that an action renders after it renews the session (HY-72.3), through the Node binding of the
// core. The test drives the built addon of `native/generated`, not a stand-in: the page input holds the masked value
// of the token of before the action, the input of the action step holds the masked value of the new token, and the
// shared data of the answer holds the new one.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

interface Step {
  readonly step: string;
  readonly call?: { readonly call: string };
  readonly answer?: { readonly answer: string; readonly status?: number; readonly text?: string; readonly html?: string };
}

interface Addon {
  readonly Pages: new (manifest: Uint8Array, templates: Map<string, string>, reads: unknown, options: object) => object;
  readonly PageRequest: new (pages: object, input: object) => { next(input: object): Step };
}

function isAddon(module: unknown): module is Addon {
  return typeof module === 'object' && module !== null && typeof Reflect.get(module, 'Pages') === 'function' && typeof Reflect.get(module, 'PageRequest') === 'function';
}

function builtAddon(): Addon {
  const module: unknown = createRequire(import.meta.url)('../native/generated/index.cjs');
  if (!isAddon(module)) throw new Error('the addon of native/generated has no class Pages or PageRequest; run make node-addon');
  return module;
}

const addon = builtAddon();

const MANIFEST = {
  layout: 'layout.tpl',
  title: 'title.tpl',
  regions: [{ name: 'content', page: true }],
  routes: [{ name: 'home', path: '/', title: 'Home', template: 'page.tpl' }],
};

const TEMPLATES = new Map([
  ['layout.tpl', '<title>{# title}</title>{# build}\n<main id="content">{# content}</main>\n{# data}\n'],
  ['title.tpl', '{= title} - Site'],
  ['page.tpl', '<p>token={= csrf}</p>\n'],
]);

function pages(): object {
  const reads = new Map([['home', new Map<string, unknown>([['shared', true], ['regions', new Map([['content', true]])]])]]);
  const options = { build: '1'.repeat(64), timezone: 'Z', context: false, basePath: '', formTypes: ['application/x-www-form-urlencoded'] };
  return new addon.Pages(new TextEncoder().encode(JSON.stringify(MANIFEST)), TEMPLATES, reads, options);
}

// The answer of a POST of the route `home` whose action returns the page; `renewed` is the member `csrf` of the
// input of the action step, or absent for an action that did not renew the session.
function answerOf(kind: 'html' | 'region_json', renewed: string | undefined): Step['answer'] {
  const page = new addon.PageRequest(pages(), { route: 'home', params: new Map(), kind, action: true, csrf: 'before', changed: [], now: 0 });
  expect(page.next({ input: 'start' }).call?.call).toBe('action');
  const outcome = { outcome: 'page', status: 200, data: new Map() };
  const action = renewed === undefined ? { input: 'action', outcome } : { input: 'action', outcome, csrf: renewed };
  expect(page.next(action).call?.call).toBe('shared');
  expect(page.next({ input: 'no_handler' }).call?.call).toBe('route_loader');
  expect(page.next({ input: 'no_handler' }).call?.call).toBe('reply');
  return page.next({ input: 'reply', embeds: false, stored: new Map() }).answer;
}

describe('the token of a page after its action (HY-72.3)', () => {
  it('a JSON response holds the masked value that the action step gives', () => {
    const answer = answerOf('region_json', 'after');
    expect(JSON.parse(answer?.text ?? '{}')).toMatchObject({ shared: { csrf: 'after' } });
  });

  it('a document holds the masked value that the action step gives', () => {
    expect(answerOf('html', 'after')?.html).toContain('<p>token=after</p>');
  });

  it('an action step without the member keeps the masked value of the page input', () => {
    const answer = answerOf('region_json', undefined);
    expect(JSON.parse(answer?.text ?? '{}')).toMatchObject({ shared: { csrf: 'before' } });
    expect(answerOf('html', undefined)?.html).toContain('<p>token=before</p>');
  });
});
