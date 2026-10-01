import { parse, type Template } from '@polyspec/template';
import { readFileSync } from 'node:fs';
import { createApplication, DATA_TEMPLATE_NAME, type Application, type Manifest, type TemplateIndex } from '../src/index.js';

const DATA_TEMPLATE_SOURCE: string = JSON.parse(readFileSync(new URL('../data-template.json', import.meta.url), 'utf8')).source;

export const manifest: Manifest = {
  layout: 'layout.tpl',
  title: 'title.tpl',
  regions: [
    { name: 'side', template: 'side.tpl', uses: ['count'] },
    { name: 'content', page: true },
  ],
  routes: [
    { name: 'home', path: '/', title: 'Home', template: 'page.tpl' },
    { name: 'item', path: '/items/{id}', title: 'Item', template: 'item.tpl' },
    { name: 'when', path: '/when', title: 'When', template: 'when.tpl' },
    { name: 'list', path: '/list', title: 'List', template: 'list.tpl', regions: [{ name: 'rows', template: 'rows.tpl', keep: { 'items.0.open': 'server', 'items.1.open': 'localStorage', flag: 'cookie', tab: 'sessionStorage', tags: 'cookie', marks: 'localStorage' } }] },
  ],
};

export const sources: Record<string, string> = {
  'layout.tpl': '<title>{# title}</title>\n<aside id="side" hy-region>{# side}</aside>\n<main id="content" hy-region>{# content}</main>\n{# data}\n',
  'title.tpl': '{= title} - Site',
  'side.tpl': '<b>{= count}</b>',
  'page.tpl': '<p>{= title}|{= name}|{= shared_only}</p>',
  'item.tpl': '<i>{= id}</i>{+ part.tpl}',
  'part.tpl': '<u>part</u>',
  'when.tpl': '{= date(at, "Y-m-d H:i")}',
  'list.tpl': '<h1>{= heading}</h1><ul id="rows" hy-region>{# rows}</ul>',
  // A loop over each item of tags and marks fails for an item that is not a list, a map or null.
  'rows.tpl': '{@ r = items}<li{? r.open} class="open"{/}>{= r.name}</li>{/}{@ t = tags}{@ x = t}{= x}{/}{/}{@ t = marks}{@ x = t}{= x}{/}{/}',
  [DATA_TEMPLATE_NAME]: DATA_TEMPLATE_SOURCE,
};

const deps: Record<string, string[]> = { 'item.tpl': ['part.tpl'] };

// Creates an application whose template fetcher records the requested URLs.
export function testApplication(fetched: string[] = []): Application {
  const parsed: Record<string, Template> = Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, parse(source, name)]));
  const index: TemplateIndex = Object.fromEntries(Object.keys(sources).map((name) => [name, { url: `/t/${name}`, deps: deps[name] ?? [] }]));
  return createApplication(manifest, index, async (url) => {
    fetched.push(url);
    return parsed[url.slice('/t/'.length)]!;
  });
}

// Creates an application with every template loaded.
export async function loadedApplication(): Promise<Application> {
  const app = testApplication();
  await app.templates.ensure(Object.keys(sources));
  return app;
}

// Creates an application whose template fetcher always fails.
export function testApplicationFailing(): Application {
  const index: TemplateIndex = Object.fromEntries(Object.keys(sources).map((name) => [name, { url: `/t/${name}`, deps: deps[name] ?? [] }]));
  return createApplication(manifest, index, async () => {
    throw new Error('404');
  });
}
