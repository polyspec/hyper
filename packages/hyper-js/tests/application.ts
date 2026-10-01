import { parse } from '@polyspec/template';
import { createApplication, type Application, type Manifest } from '../src/index.js';

const manifest: Manifest = {
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
  ],
};

const sources: Record<string, string> = {
  'layout.tpl': '<title>{# title}</title>\n<aside id="side" hy-region>{# side}</aside>\n<main id="content" hy-region>{# content}</main>\n',
  'title.tpl': '{= title} - Site',
  'side.tpl': '<b>{= count}</b>',
  'page.tpl': '<p>{= title}|{= name}|{= shared_only}</p>',
  'item.tpl': '<i>{= id}</i>',
  'when.tpl': '{= date(at, "Y-m-d H:i")}',
};

// Creates the application that the extension and response tests share.
export function testApplication(): Application {
  return createApplication(manifest, Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, parse(source, name)])));
}
