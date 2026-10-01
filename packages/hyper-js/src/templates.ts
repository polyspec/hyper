import { MapLoader, resolvePath, type Template } from '@polyspec/template/render';
import { DATA_TEMPLATE_NAME, type Manifest, type RouteDeclaration } from './manifest.js';

// Template name to its file URL and the templates that it references by path (HY-34).
export type TemplateIndex = Record<string, { url: string; deps: string[] }>;

// Returns the parsed template stored at a URL.
export type TemplateFetcher = (url: string) => Promise<Template>;

// Loads templates on demand into the loader of the engine and keeps them (HY-35).
export class TemplateStore {
  private readonly loading = new Map<string, Promise<void>>();
  private readonly index: TemplateIndex;
  private readonly fetcher: TemplateFetcher;
  readonly loader: MapLoader;

  constructor(index: TemplateIndex, fetcher: TemplateFetcher, loader: MapLoader) {
    this.index = index;
    this.fetcher = fetcher;
    this.loader = loader;
  }

  // Returns the names and every template that they reference, transitively.
  closure(names: readonly string[]): string[] {
    const result = new Set<string>();
    const visit = (name: string): void => {
      if (result.has(name)) return;
      const entry = this.index[name];
      if (entry === undefined) throw new Error(`hyper: template ${name} is not in the template index`);
      result.add(name);
      entry.deps.forEach(visit);
    };
    names.forEach(visit);
    return [...result];
  }

  // Loads every template of the closure that is not loaded yet; requests run in parallel.
  ensure(names: readonly string[]): Promise<void> {
    return Promise.all(this.closure(names).map((name) => this.load(name))).then(() => undefined);
  }

  // Returns true when a template is loaded.
  loaded(name: string): boolean {
    return this.loader.load(name) !== null;
  }

  private load(name: string): Promise<void> {
    let pending = this.loading.get(name);
    if (pending === undefined) {
      pending = this.fetcher(this.index[name]!.url).then((template) => this.loader.set(name, template));
      pending.catch(() => this.loading.delete(name));
      this.loading.set(name, pending);
    }
    return pending;
  }
}

// Returns the names of the templates that the include and block tags of a parsed template
// reference by path, resolved against the template name (HY-34).
export function templateReferences(ast: Template, name: string): string[] {
  const found = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const item = node as { type?: unknown; path?: unknown };
    if ((item.type === 'Include' || item.type === 'Block') && typeof item.path === 'string') found.add(resolvePath(name, item.path));
    Object.values(node).forEach(visit);
  };
  visit(ast.body);
  return [...found].sort();
}

// Returns the templates that rendering a route needs before references are followed (HY-35).
export function routeTemplates(manifest: Manifest, route: RouteDeclaration): string[] {
  const regions = manifest.regions.flatMap((region) => (region.template === undefined ? [] : [region.template]));
  const routeRegions = (route.regions ?? []).map((region) => region.template);
  return [manifest.layout, manifest.title, DATA_TEMPLATE_NAME, ...regions, route.template, ...routeRegions];
}
