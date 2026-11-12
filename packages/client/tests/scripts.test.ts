// The module scripts of a source head created in the head of the page (HYC-25).
import { describe, expect, it } from 'vitest';
import { HeadError } from '../src/head.js';
import { PageScripts, ScriptError, scriptKey, type ScriptElement, type ScriptPage } from '../src/scripts.js';

const base = 'http://site.test/board/7';

// A script element stub that records its attributes and its listeners.
class FakeScript implements ScriptElement {
  readonly values = new Map<string, string>();
  readonly listeners = new Map<string, () => void>();
  async = true;
  removed = false;
  constructor(attributes: Record<string, string> = {}) {
    for (const [name, value] of Object.entries(attributes)) this.values.set(name, value);
  }
  get attributes(): { name: string; value: string }[] {
    return Array.from(this.values, ([name, value]) => ({ name, value }));
  }
  getAttribute(name: string): string | null {
    return this.values.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.values.set(name, value);
  }
  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, listener);
  }
  remove(): void {
    this.removed = true;
  }
  // Dispatches the load or the error event of the script; a script without that listener fails the test.
  dispatch(type: 'load' | 'error'): void {
    const listener = this.listeners.get(type);
    if (listener === undefined) throw new Error(`the script has no ${type} listener`);
    listener();
  }
}

// A page stub: the scripts that its document held when it opened and the scripts that were put at the end of its head.
class FakePage implements ScriptPage<FakeScript> {
  readonly held: FakeScript[];
  readonly appended: FakeScript[] = [];
  // the content of the hyper-entry meta element of the page (HYC-16)
  inlined: string | null = null;
  constructor(held: FakeScript[] = []) {
    this.held = held;
  }
  base(): string {
    return base;
  }
  scripts(): FakeScript[] {
    return [...this.held, ...this.appended].filter((script) => !script.removed);
  }
  entry(): string | null {
    return this.inlined;
  }
  // whether the page has the hyper-api meta element of a static shell (HYC-8)
  static = false;
  shell(): boolean {
    return this.static;
  }
  element(): FakeScript {
    return new FakeScript();
  }
  append(script: FakeScript): void {
    this.appended.push(script);
  }
}

const moduleScript = (src: string, more: Record<string, string> = {}): FakeScript => new FakeScript({ type: 'module', src, ...more });

// Returns the appended script at an index; a missing script fails the test.
function appended(page: FakePage, index: number): FakeScript {
  const script = page.appended[index];
  if (script === undefined) throw new Error(`the page has no appended script ${index}`);
  return script;
}

// Returns whether a promise has settled after the pending promise jobs ran: 'loaded', 'failed' or 'pending'.
async function stateOf(promise: Promise<void>): Promise<string> {
  let state = 'pending';
  promise.then(() => { state = 'loaded'; }, () => { state = 'failed'; });
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
  return state;
}

describe('scriptKey (HYC-25)', () => {
  it('resolves the src of a module script against the page URL', () => {
    expect(scriptKey('module', '/assets/reader.js', base)).toBe('http://site.test/assets/reader.js');
    expect(scriptKey('module', 'reader.js', base)).toBe('http://site.test/board/reader.js');
    expect(scriptKey('module', 'http://site.test/assets/reader.js', base)).toBe('http://site.test/assets/reader.js');
  });

  it('finds the type module in any ASCII case and between ASCII whitespace', () => {
    expect(scriptKey('Module', '/a.js', base)).toBe('http://site.test/a.js');
    expect(scriptKey(' module\n', '/a.js', base)).toBe('http://site.test/a.js');
  });

  it('is null for a script without src or of another type', () => {
    expect(scriptKey('module', null, base)).toBeNull();
    expect(scriptKey(null, '/a.js', base)).toBeNull();
    expect(scriptKey('', '/a.js', base)).toBeNull();
    expect(scriptKey('text/javascript', '/a.js', base)).toBeNull();
    expect(scriptKey('modules', '/a.js', base)).toBeNull();
  });
});

describe('PageScripts (HYC-25)', () => {
  it('creates the module scripts that the page does not hold at the end of the head, in the order of the source, with their attributes', async () => {
    const page = new FakePage([moduleScript('/assets/app.js'), new FakeScript({ src: '/assets/classic.js' })]);
    const part = new PageScripts(page).create([
      moduleScript('/assets/app.js'),
      moduleScript('/assets/reader.js', { crossorigin: 'anonymous' }),
      // a classic script, a module script without src and a key that appears again are not created
      new FakeScript({ src: '/assets/classic.js' }),
      new FakeScript({ type: 'module' }),
      moduleScript('http://site.test/assets/reader.js'),
      moduleScript('/assets/chart.js', { async: '' }),
    ]);
    expect(page.appended.map((script) => Object.fromEntries(script.values))).toEqual([
      { type: 'module', src: '/assets/reader.js', crossorigin: 'anonymous' },
      { type: 'module', src: '/assets/chart.js', async: '' },
    ]);
    // A created script runs in the order of the source unless the source script has the attribute async.
    expect(page.appended.map((script) => script.async)).toEqual([false, true]);
    const waiting = part.wait();
    expect(await stateOf(waiting)).toBe('pending');
    appended(page, 0).dispatch('load');
    expect(await stateOf(waiting)).toBe('pending');
    appended(page, 1).dispatch('load');
    expect(await stateOf(waiting)).toBe('loaded');
  });

  it('holds the entry that the static shell inlines and does not create it', async () => {
    const page = new FakePage();
    page.static = true;
    page.inlined = '/assets/hyper-AAAAAAAA.js';
    const part = new PageScripts(page).create([moduleScript('/assets/hyper-AAAAAAAA.js'), moduleScript('/assets/reader.js')]);
    expect(page.appended.map((script) => script.getAttribute('src'))).toEqual(['/assets/reader.js']);
    appended(page, 0).dispatch('load');
    await part.wait();
  });

  it('fails before it creates a script in a static shell that does not declare its entry', () => {
    const page = new FakePage([moduleScript('/assets/app.js')]);
    page.static = true;
    const scripts = new PageScripts(page);
    // A source that names only scripts that the page holds creates nothing and does not fail.
    scripts.create([moduleScript('/assets/app.js')]);
    let error: unknown;
    try {
      scripts.create([moduleScript('/assets/app.js'), moduleScript('/assets/hyper-AAAAAAAA.js'), moduleScript('/assets/reader.js')]);
    } catch (failure) {
      error = failure;
    }
    expect(error).toBeInstanceOf(HeadError);
    expect(error).toHaveProperty('message', 'hyper: the static shell declares no hyper-entry, so the module script http://site.test/assets/hyper-AAAAAAAA.js is not created');
    expect(page.appended).toHaveLength(0);
  });

  it('creates no script again and removes none when a later source does not name it', async () => {
    const page = new FakePage();
    const scripts = new PageScripts(page);
    const first = scripts.create([moduleScript('/assets/reader.js')]);
    appended(page, 0).dispatch('load');
    await first.wait();
    first.settle();
    const second = scripts.create([]);
    await second.wait();
    second.settle();
    const third = scripts.create([moduleScript('/assets/reader.js')]);
    await third.wait();
    third.settle();
    expect(page.appended).toHaveLength(1);
    expect(appended(page, 0).removed).toBe(false);
  });

  it('waits for a script that an earlier application created and that is still loading', async () => {
    const page = new FakePage();
    const scripts = new PageScripts(page);
    scripts.create([moduleScript('/assets/reader.js')]);
    const later = scripts.create([moduleScript('/assets/reader.js')]).wait();
    expect(page.appended).toHaveLength(1);
    expect(await stateOf(later)).toBe('pending');
    appended(page, 0).dispatch('load');
    expect(await stateOf(later)).toBe('loaded');
  });

  it('fails with the address of a script that does not load and removes only the scripts that the application created', async () => {
    const page = new FakePage();
    const scripts = new PageScripts(page);
    const first = scripts.create([moduleScript('/assets/app.js')]);
    appended(page, 0).dispatch('load');
    await first.wait();
    const second = scripts.create([moduleScript('/assets/app.js'), moduleScript('/assets/reader.js'), moduleScript('/assets/chart.js')]);
    appended(page, 1).dispatch('error');
    const error = await second.wait().catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ScriptError);
    expect(error).toBeInstanceOf(HeadError);
    expect(error).toHaveProperty('message', 'hyper: module script http://site.test/assets/reader.js failed to load');
    second.remove();
    expect(page.appended.map((script) => script.removed)).toEqual([false, true, true]);
    // The page no longer holds the removed scripts, so the next application creates them again.
    scripts.create([moduleScript('/assets/reader.js')]);
    expect(page.appended).toHaveLength(4);
  });
});
