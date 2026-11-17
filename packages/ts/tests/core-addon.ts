// The built addon of `native/generated`, the Node binding of the core, and the pages of one route `home` that the
// tests of the core through that binding drive, not a stand-in.
import { createRequire } from 'node:module';

export interface Step {
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

export const addon = builtAddon();

const MANIFEST = {
  layout: 'layout.tpl',
  title: 'title.tpl',
  regions: [{ name: 'content', page: true }],
  routes: [{ name: 'home', path: '/', title: 'Home', template: 'page.tpl' }],
};

// The pages of the route `home`, whose template is `page`; `regions` are the regions whose data the route reads.
export function pages(page: string, regions: Map<string, boolean>): object {
  const templates = new Map([
    ['layout.tpl', '<title>{# title}</title>{# build}\n<main id="content">{# content}</main>\n{# data}\n'],
    ['title.tpl', '{= title} - Site'],
    ['page.tpl', page],
  ]);
  const reads = new Map([['home', new Map<string, unknown>([['shared', true], ['regions', regions]])]]);
  const options = { build: '1'.repeat(64), timezone: 'Z', context: false, basePath: '', formTypes: ['application/x-www-form-urlencoded'] };
  return new addon.Pages(new TextEncoder().encode(JSON.stringify(MANIFEST)), templates, reads, options);
}
