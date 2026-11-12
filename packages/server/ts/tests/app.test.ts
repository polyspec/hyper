// The application beyond the cases of contracts/app.json: the parts that the browser code renders alone (HY-13), the
// outputs of the build that `open` reads (HY-48) and the one argument of a Node handler (HY-54).
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { checkManifest, createApplication, decodeResponse, renderParts, type TemplateIndex } from '@polyspec/hyper-client';
import { decodeTemplate, parseJson } from '@polyspec/template/render';
import { App, Result } from '../src/index.js';
import { Fixture, FIXTURES, handlers, json, JSON_REGION, parsed, record, TEMPLATES, text } from './support.js';
import { requestOf } from '../src/http-host.js';

let fixture: Fixture;
beforeEach(() => {
  fixture = new Fixture();
});

describe('App', () => {
  it('renders parts alone that match the document (HY-13)', async () => {
    const manifest = checkManifest(JSON.parse(readFileSync(`${FIXTURES}app.json`, 'utf8')));
    const index: TemplateIndex = Object.fromEntries(Object.entries(record(parsed(readFileSync(TEMPLATES.index, 'utf8')))).map(([name, entry]) => [name, { url: text(record(entry).url) }]));
    const application = createApplication(manifest, index, async (url) => decodeTemplate(JSON.parse(readFileSync(`${TEMPLATES.root}${url}`, 'utf8'))));
    await application.templates.ensure(Object.keys(index));
    const document = (await fixture.get('/')).body;
    const parts = renderParts(application, decodeResponse(application, parseJson((await fixture.get('/', { Accept: 'application/vnd.hyper+json' })).body), '/'));
    expect(document).toContain(`<title>${parts.title}</title>`);
    expect(document).toContain(`<aside id="side">${parts.regions.get('side')}</aside>`);
    expect(parts.regions.get('content')).toBe('<p>Home|n0</p>\n');
    expect(document).toContain('<main id="content"><p>Home|n0</p>\n</main>');
  });

  it('opens only when every output of the build exists and names the first missing one (HY-48)', async () => {
    const missing = `${TEMPLATES.root}without/templates.index.json`;
    await expect(App.open({ manifest: `${FIXTURES}app.json`, build: `${FIXTURES}build.json`, templates: { index: missing, root: TEMPLATES.root }, handlers: handlers(), timezone: 'Z' })).rejects.toThrow(missing);
    const absent = `${FIXTURES}without-app.json`;
    await expect(App.open({ manifest: absent, build: `${FIXTURES}build.json`, templates: TEMPLATES, handlers: handlers(), timezone: 'Z' })).rejects.toThrow(absent);
    await expect(App.open({ manifest: `${FIXTURES}app.json`, build: `${FIXTURES}build.json`, templates: { index: 'templates.index.json', root: TEMPLATES.root }, handlers: handlers(), timezone: 'Z' })).rejects.toThrow('not an absolute path');
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
    const response = json(await app.handle(requestOf({ method: 'GET', target: '/', headers: JSON_REGION }), fixture.session));
    expect(seen).toEqual([['reply', 'request', 'services'], true]);
    // HY-73: no template of the route reads site or csrf.
    expect(response.shared).toEqual({ title: 'Home' });
  });

  it('requires absolute paths and a template for every route (HR-34, HY-54)', async () => {
    await expect(App.open({ manifest: 'app.json', build: `${FIXTURES}build.json`, templates: TEMPLATES, timezone: 'Z', handlers: {} })).rejects.toThrow('absolute');
    await expect(App.open({ manifest: `${FIXTURES}app.json`, build: `${FIXTURES}build.json`, templates: { index: `${FIXTURES}app.json`, root: TEMPLATES.root }, timezone: 'Z', handlers: { routes: { add: { post: () => Result.redirect('/') } } } })).rejects.toThrow('template index');
  });
});
