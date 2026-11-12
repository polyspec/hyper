// The session of a request is opened only after its refusals (HY-120): a request that is refused before the session
// opens calls no store method and sets no cookie. contracts/client.json states the other refusals.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { App, ArraySession, Result, type Handlers, type SessionStore } from '../src/index.js';
import type { Value } from '../src/values.js';
import { requestOf } from '../src/http-host.js';

// A session store that records every call of its interface and keeps the values in memory.
class CountingStore implements SessionStore {
  readonly calls: string[] = [];
  private readonly inner = new ArraySession();

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
});
