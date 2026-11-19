// A server opens the session of a request only for a route that uses it (HY-104.38): a request of a route that the
// manifest declares with `"session": false` takes no lock of a session and answers while another request holds it.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FileSessions, server as hostServer } from '../src/index.js';
import { FIXTURES, Fixture, handlers, port } from './support.js';

const COOKIE = `hy-session=${'a'.repeat(32)}`;

let directory: string;
let server: Server | undefined;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'hyper-session-routes-'));
});

afterEach(async () => {
  const running = server;
  server = undefined;
  if (running !== undefined) await new Promise<void>((resolve) => running.close(() => resolve()));
  rmSync(directory, { recursive: true, force: true });
});

// The manifest of the fixture with `"session": false` on the route `item`, written into the directory of the test.
function manifest(): string {
  // The route `item` of the fixture, whose program the fixture builds, uses no session; a route that the program does
  // not hold could not render.
  const app: unknown = JSON.parse(readFileSync(`${FIXTURES}app.json`, 'utf8'));
  const routes: unknown = typeof app === 'object' && app !== null ? Reflect.get(app, 'routes') : undefined;
  if (!Array.isArray(routes)) throw new Error(`${FIXTURES}app.json holds no routes`);
  const list: unknown[] = routes;
  for (const route of list) {
    if (typeof route === 'object' && route !== null && Reflect.get(route, 'name') === 'item') Reflect.set(route, 'session', false);
  }
  const file = join(directory, 'app.json');
  writeFileSync(file, JSON.stringify(app));
  return file;
}

it('a request of a route without a session answers while the session is held (HY-104.38)', async () => {
  let entered: () => void = () => undefined;
  const running = new Promise<void>((resolve) => (entered = resolve));
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => (release = resolve));
  const base = handlers();
  const app = await new Fixture().app({
    manifest: manifest(),
    handlers: {
      ...base,
      regions: { side: () => ({ count: 0, note: null }) },
      routes: {
        ...base.routes,
        home: {
          load: async () => {
            entered();
            await released;
            return { name: 'held' };
          },
        },
      },
    },
  });
  const sessions = join(directory, 'sessions');
  mkdirSync(sessions);
  const store = await FileSessions.inDirectory({ directory: sessions });
  // A second open of the library store, in which the host opens the session, is the failure that the test states: it
  // would wait for the lock of the held request, so it releases that request first and the order of the answers shows
  // the failure instead of a wait without an end.
  const order: string[] = [];
  const library = store.library;
  const open = library.open.bind(library);
  let opens = 0;
  library.open = (cookie) => {
    opens++;
    if (opens === 2) {
      order.push('plain opened the session');
      release();
    }
    return open(cookie);
  };
  server = hostServer(app, store);
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${port(server)}`;

  const held = fetch(`${url}/`, { headers: { Cookie: COOKIE } }).then((response) => order.push(`held ${response.status}`));
  await running;
  const plain = await fetch(`${url}/items/1`,{ headers: { Cookie: COOKIE } });
  order.push(`plain ${plain.status}`);
  release();
  await held;
  expect(order).toEqual(['plain 200', 'held 200']);
});
