// Applies the stylesheet links of the head of a source document to the head of the page (HY-64).

// One step of an application: the index of a source link, and the index of the page link that is kept for it, or
// null when a copy of the source link is inserted.
export interface StylesheetStep {
  source: number;
  kept: number | null;
}

// Returns the key of a stylesheet link: its href resolved against the page URL, or null when the element is not a
// stylesheet link because it has no href or its rel has no token `stylesheet` in any ASCII case (HY-64).
export function stylesheetKey(rel: string | null, href: string | null, base: string): string | null {
  if (href === null || rel === null) return null;
  if (!rel.split(/[\t\n\f\r ]+/).some((token) => token.toLowerCase() === 'stylesheet')) return null;
  return new URL(href, base).href;
}

// Plans an application from the keys of the page links and the source links, in order. A key that appears again in
// the source counts only at its first link. For each source link the first page link with its key after the last kept
// link is kept; otherwise a copy of the source link is inserted (HY-64).
export function planStylesheets(page: readonly string[], source: readonly string[]): StylesheetStep[] {
  const steps: StylesheetStep[] = [];
  const seen = new Set<string>();
  let next = 0;
  source.forEach((key, index) => {
    if (seen.has(key)) return;
    seen.add(key);
    const found = page.indexOf(key, next);
    if (found >= 0) next = found + 1;
    steps.push({ source: index, kept: found >= 0 ? found : null });
  });
  return steps;
}

// A stylesheet link that failed to load (HY-47, HY-64).
export class StylesheetError extends Error {
  constructor(href: string) {
    super(`hyper: stylesheet ${href} failed to load`);
    this.name = 'StylesheetError';
  }
}

interface Link {
  element: HTMLLinkElement;
  key: string;
}

// The stylesheet links of the head of a browser page.
export class PageStylesheets {
  private generation = 0;
  // the loading of every link that an application inserted
  private readonly loading = new WeakMap<Element, Promise<void>>();
  private readonly page: Document;

  constructor(page: Document) {
    this.page = page;
  }

  // Inserts the missing stylesheet links of the head of a source document in its order and waits until every inserted
  // link and every kept link that is still loading has loaded. The returned function removes every other stylesheet
  // link of the page; it removes nothing when a later application has started. When a link fails to load, the links
  // that this application inserted are removed and the promise rejects (HY-64).
  async apply(source: Document): Promise<() => void> {
    const generation = ++this.generation;
    const present = this.links(this.page);
    const wanted = this.links(source);
    const chosen: HTMLLinkElement[] = [];
    const inserted: HTMLLinkElement[] = [];
    let last: HTMLLinkElement | null = null;
    for (const step of planStylesheets(present.map((link) => link.key), wanted.map((link) => link.key))) {
      if (step.kept !== null) {
        last = present[step.kept]!.element;
        chosen.push(last);
        continue;
      }
      const link = this.page.importNode(wanted[step.source]!.element, true);
      this.loading.set(link, loaded(link, wanted[step.source]!.key));
      if (last !== null) last.after(link);
      else if (present.length > 0) present[0]!.element.before(link);
      else this.page.head.append(link);
      last = link;
      chosen.push(link);
      inserted.push(link);
    }
    try {
      await Promise.all(chosen.map((link) => this.loading.get(link)));
    } catch (error) {
      for (const link of inserted) link.remove();
      throw error;
    }
    return () => {
      if (generation !== this.generation) return;
      for (const { element } of this.links(this.page)) if (!chosen.includes(element)) element.remove();
    };
  }

  private links(document: Document): Link[] {
    const links: Link[] = [];
    for (const element of Array.from(document.head?.querySelectorAll('link') ?? [])) {
      const key = stylesheetKey(element.getAttribute('rel'), element.getAttribute('href'), this.page.baseURI);
      if (key !== null) links.push({ element, key });
    }
    return links;
  }
}

// Resolves when a link loads and rejects when it fails to load.
function loaded(link: HTMLLinkElement, key: string): Promise<void> {
  const promise = new Promise<void>((resolve, reject) => {
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => reject(new StylesheetError(key)), { once: true });
  });
  // A page that no longer waits for the link does not report its failure again.
  promise.catch(() => undefined);
  return promise;
}
