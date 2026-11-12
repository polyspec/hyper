// The session of a request is opened only after its refusals (HY-120): a request that is refused before the session
// opens calls no store method and sets no cookie, and a page request that selects text/html does call the store.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { App, MemorySessionStore, Request, Result, type Handlers, type SessionStore } from '../src/index.js';
import type { Value } from '../src/values.js';
import { Fixture } from './support.js';
import { requestOf } from '../src/http.js';

// A session store that records every call of its interface and keeps the values in memory.
class CountingStore implements SessionStore {
  readonly calls: string[] = [];
  private readonly inner = new MemorySessionStore();

  get(key: string): unknown {
    this.calls.push(`get ${key}`);
    return this.inner.get(key);
  }

  set(key: string, value: unknown): void {
    this.calls.push(`set ${key}`);
    this.inner.set(key, value);
  }

  remove(key: string): void {
    this.calls.push(`remove ${key}`);
    this.inner.remove(key);
  }

  renew(): void {
    this.calls.push('renew');
    this.inner.renew();
  }
}

const withContextDir = fileURLToPath(new URL('../../../../var/contract-programs/with_context/', import.meta.url));

describe('the session of a request (HY-120)', () => {
  it('opens no session for a body above the body limit (HY-59)', async () => {
    const store = new CountingStore();
    const app = await new Fixture().app({ bodyLimit: 4 });
    const body = Buffer.from('name=too-long', 'latin1');
    const response = await app.handle(requestOf({ method: 'POST', target: '/', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }), store);
    expect(response.status).toBe(413);
    expect(store.calls).toEqual([]);
    expect(response.headers['Set-Cookie']).toBeUndefined();
  });

  it('opens no session for an invalid Hyper-Context of an application with a context (HY-127)', async () => {
    // Every route of the application has its handler; a POST route gets a page for its action (HY-106).
    const manifest = JSON.parse(readFileSync(`${withContextDir}manifest.json`, 'utf8')) as { routes: { name: string; post?: boolean }[] };
    const handlers: Handlers<Record<string, never>> = {
      routes: Object.fromEntries(manifest.routes.map((route) => [route.name, route.post === true ? { load: () => new Map(), post: () => Result.page(200, {}) } : { load: () => new Map() }])),
    };
    const app = await App.open<Record<string, never>>({
      manifest: `${withContextDir}manifest.json`,
      build: `${withContextDir}build.json`,
      templates: { index: `${withContextDir}node/templates.index.json`, root: `${withContextDir}node` },
      handlers,
      timezone: '+09:00',
      log: () => {},
      context: () => new Map<string, Value>(),
    });
    const store = new CountingStore();
    const response = await app.handle(requestOf({ method: 'GET', target: '/', headers: { Accept: 'text/html', 'Hyper-Context': 'ABC' } }), store);
    expect(response.status).toBe(400);
    expect(store.calls).toEqual([]);
    expect(response.headers['Set-Cookie']).toBeUndefined();
  });

  it('opens the session of a page request that selects text/html', async () => {
    const store = new CountingStore();
    const app = await new Fixture().app();
    const response = await app.handle(requestOf({ method: 'GET', target: '/', headers: { Accept: 'text/html' } }), store);
    expect(response.status).toBe(200);
    expect(store.calls.length).toBeGreaterThan(0);
  });
});
