import { MapLoader, type Loader, type LoadResult, type Template } from '@polyspec/template/render';
import { DATA_TEMPLATE_NAME, type Manifest, type RouteDeclaration } from './manifest.js';

// Template name to its file URL (HY-34).
export type TemplateIndex = Record<string, { url: string }>;

// Returns the parsed template stored at a URL.
export type TemplateFetcher = (url: string) => Promise<Template>;

// Loads templates on demand into the loader of the engine and keeps them (HY-35). The loader records every name that a
// rendering requested and the store did not hold, so that a rendering loads exactly the templates that it reaches.
export class TemplateStore {
  private readonly loading = new Map<string, Promise<void>>();
  private readonly index: TemplateIndex;
  private readonly fetcher: TemplateFetcher;
  private readonly held = new MapLoader();
  private readonly missing = new Set<string>();
  readonly loader: Loader;

  constructor(index: TemplateIndex, fetcher: TemplateFetcher) {
    this.index = index;
    this.fetcher = fetcher;
    this.loader = {
      load: (name: string): LoadResult | null => {
        const result = this.held.load(name);
        if (result === null) this.missing.add(name);
        return result;
      },
    };
  }

  // Loads every named template that is not loaded yet; requests run in parallel.
  ensure(names: readonly string[]): Promise<void> {
    for (const name of names) {
      if (this.index[name] === undefined) throw new Error(`hyper: template ${name} is not in the template index`);
    }
    return Promise.all(names.map((name) => this.load(name))).then(() => undefined);
  }

  // Returns true when a template is loaded.
  loaded(name: string): boolean {
    return this.held.load(name) !== null;
  }

  // Runs a rendering, and while it fails because it requested templates that are not loaded, loads them and runs it
  // again (HY-35). A requested name that the index does not hold, or a failure for another reason, rejects.
  async render<T>(rendering: () => T): Promise<T> {
    for (;;) {
      this.missing.clear();
      try {
        return rendering();
      } catch (error) {
        const names = [...this.missing].filter((name) => !this.loaded(name));
        if (names.length === 0 || names.some((name) => this.index[name] === undefined)) throw error;
        await this.ensure(names);
      }
    }
  }

  private load(name: string): Promise<void> {
    let pending = this.loading.get(name);
    if (pending === undefined) {
      pending = this.fetcher(this.index[name]!.url).then((template) => this.held.set(name, template));
      pending.catch(() => this.loading.delete(name));
      this.loading.set(name, pending);
    }
    return pending;
  }
}

// Returns the entry templates of a route: the templates that rendering it starts from (HY-35).
export function routeTemplates(manifest: Manifest, route: RouteDeclaration): string[] {
  const regions = manifest.regions.flatMap((region) => (region.template === undefined ? [] : [region.template]));
  const routeRegions = (route.regions ?? []).map((region) => region.template);
  return [manifest.layout, manifest.title, DATA_TEMPLATE_NAME, ...regions, route.template, ...routeRegions];
}
