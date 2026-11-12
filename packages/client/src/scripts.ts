// Creates the module scripts of the head of a source document in the head of the page (HYC-25).
import { HeadError, type HeadPart } from './head.js';

// Returns the key of a module script: its src resolved against the page URL, or null when the element is not a module
// script because it has no src or its type, without leading and trailing ASCII whitespace, is not `module` in any
// ASCII case (HYC-25).
export function scriptKey(type: string | null, src: string | null, base: string): string | null {
  if (src === null || type === null) return null;
  if (type.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '').toLowerCase() !== 'module') return null;
  return new URL(src, base).href;
}

// A module script that failed to load (HYC-14, HYC-25).
export class ScriptError extends HeadError {
  constructor(src: string) {
    super(`hyper: module script ${src} failed to load`);
    this.name = 'ScriptError';
  }
}

// A script element as an application reads and creates it. A DOM HTMLScriptElement is one.
export interface ScriptElement {
  readonly attributes: ArrayLike<{ readonly name: string; readonly value: string }>;
  async: boolean;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void;
  remove(): void;
}

// The page whose head receives the scripts.
export interface ScriptPage<E extends ScriptElement> {
  // Returns the URL against which the page resolves an address.
  base(): string;
  // Returns the script elements of the page.
  scripts(): E[];
  // Returns whether the page is a static shell, which inlines the client entry: a page with the `hyper-api` meta
  // element (HYC-8).
  shell(): boolean;
  // Returns the URL of the client entry that the static shell of the page inlines, the content of its `hyper-entry`
  // meta element, or null for a page without that element (HYC-16).
  entry(): string | null;
  // Returns a new script element of the page, which the page does not hold yet.
  element(): E;
  // Puts a script element at the end of the head of the page.
  append(script: E): void;
}

interface Script<E> {
  element: E;
  key: string;
}

// The module scripts of a browser page.
export class PageScripts<E extends ScriptElement> {
  // the loading of every script that an application created
  private readonly loading = new WeakMap<ScriptElement, Promise<void>>();
  private readonly page: ScriptPage<E>;

  constructor(page: ScriptPage<E>) {
    this.page = page;
  }

  // Creates a script element at the end of the head of the page for each module script of a source head whose key the
  // page does not hold, in the order of the source; a key that appears again counts only at its first script. The
  // part waits until every created script, and every script of the page with a key of the source that an earlier
  // application created and that is still loading, has loaded, and it removes the scripts that it created (HYC-25).
  create(source: readonly ScriptElement[]): HeadPart {
    const base = this.page.base();
    const present = keyed(this.page.scripts(), base);
    const wanted = keyed(source, base);
    const named = new Set(wanted.map((script) => script.key));
    const waited = present.flatMap((script) => (named.has(script.key) ? this.loading.get(script.element) ?? [] : []));
    const held = new Set(present.map((script) => script.key));
    // The page holds the entry that its static shell inlines, which has no src (HYC-16, HYC-25).
    const entry = this.page.entry();
    if (entry !== null) held.add(new URL(entry, base).href);
    const created: E[] = [];
    for (const { element: from, key } of wanted) {
      if (held.has(key)) continue;
      // A static shell that does not declare its entry cannot tell the entry from this script (HYC-25).
      if (entry === null && this.page.shell()) throw new HeadError(`hyper: the static shell declares no hyper-entry, so the module script ${key} is not created`);
      held.add(key);
      const script = this.page.element();
      for (const { name, value } of Array.from(from.attributes)) script.setAttribute(name, value);
      // A created script runs in the order of its creation only when its async is false; a script of a parsed head
      // runs in the order of the head unless it has the attribute async (HYC-25).
      script.async = from.getAttribute('async') !== null;
      const loading = loaded(script, key);
      this.loading.set(script, loading);
      waited.push(loading);
      this.page.append(script);
      created.push(script);
    }
    return {
      wait: async () => {
        await Promise.all(waited);
      },
      remove: () => {
        for (const script of created) script.remove();
      },
      // A script of the page stays (HYC-25).
      settle: () => undefined,
    };
  }
}

// Returns the module scripts of a list of script elements with their keys, in order.
function keyed<E extends ScriptElement>(elements: readonly E[], base: string): Script<E>[] {
  const scripts: Script<E>[] = [];
  for (const element of elements) {
    const key = scriptKey(element.getAttribute('type'), element.getAttribute('src'), base);
    if (key !== null) scripts.push({ element, key });
  }
  return scripts;
}

// Resolves when a script loads and rejects when it fails to load.
function loaded(script: ScriptElement, key: string): Promise<void> {
  const promise = new Promise<void>((resolve, reject) => {
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new ScriptError(key)), { once: true });
  });
  // A page that no longer waits for the script does not report its failure again.
  promise.catch(() => undefined);
  return promise;
}
