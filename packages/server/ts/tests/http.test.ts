// The HTTP server of an application with sessions in files (HY-42, HY-43, HY-45, HY-52, HY-54).
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer as createHttpServer, type Server } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileSessions, Response, type App } from '../src/index.js';
import { Fixture, FIXTURES, handlers, parsed, port, present, record, text } from './support.js';

let directory: string;
let server: Server;
let base: string;

let reports: [string | null, number, number, number][];

async function start(options: { https?: boolean; bodyLimit?: number } = {}): Promise<void> {
  reports = [];
  const app = await new Fixture().app({
    https: options.https ?? false,
    ...(options.bodyLimit === undefined ? {} : { bodyLimit: options.bodyLimit }),
    onResponse: (request, response, elapsed, reply) => reports.push([request === null ? null : `${request.method} ${request.path()}`, response.status, elapsed, reply.notes().size]),
  });
  server = app.server(new FileSessions({ directory }));
  base = await listen(server);
}

// A promise that a test settles from outside: `open()` settles `opened`.
function latch(): { opened: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

// Listens with `target` on a port that the system assigns and returns the base URL of that port.
async function listen(target: Server): Promise<string> {
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${port(target)}`;
}

// An application whose shared handler waits until `release()` is called, and whose disconnect hook records into
// `events`; `running` settles when the shared handler has started.
async function waitingApp(events: string[]): Promise<{ app: App; running: Promise<void>; release: () => void }> {
  const entered = latch();
  const released = latch();
  const app = await new Fixture().app({
    handlers: {
      ...handlers(),
      shared: async () => {
        entered.open();
        await released.opened;
        return {};
      },
    },
    onDisconnect: (request) => events.push(`disconnect ${request.method} ${request.path()}`),
  });
  return { app, running: entered.opened, release: released.open };
}

// Listens with `target`, sends a request over a socket and destroys the socket once `running` settles; `release` runs
// when the server has seen the connection close. The server registers its own listeners of a connection first, so it has
// seen the close when this one runs.
async function dropClient(target: Server, running: Promise<void>, release: () => void): Promise<void> {
  target.once('connection', (connection) => connection.once('close', () => release()));
  await listen(target);
  const socket = connect(port(target), '127.0.0.1', () => socket.write('GET / HTTP/1.1\r\nHost: x\r\n\r\n'));
  await running;
  socket.destroy();
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'hyper-http-'));
});
afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(directory, { recursive: true, force: true });
});

// Sends raw request bytes and returns the raw response text.
function raw(bytes: Buffer): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect(port(server), '127.0.0.1', () => socket.write(bytes));
    let text = '';
    socket.on('data', (chunk) => (text += chunk.toString('latin1')));
    socket.on('end', () => resolve(text));
  });
}

describe('App.server', () => {
  it('sets the session cookie of a new session and keeps the session (HY-45)', async () => {
    await start();
    // The route region of /list keeps a value on the server, so its shared data keeps csrf (HY-73).
    const first = await fetch(`${base}/list`, { headers: { Accept: 'application/json' } });
    const cookie = present(first.headers.get('set-cookie'));
    expect(cookie).toMatch(/^hy-session=[0-9a-f]{64}; path=\/; HttpOnly; SameSite=Lax$/);
    const masked = text(record(record(parsed(await first.text())).shared).csrf);
    const second = await fetch(`${base}/list`, { headers: { Accept: 'application/json', Cookie: present(cookie.split(';')[0]) } });
    expect(second.headers.get('set-cookie')).toBeNull();
    // HY-24: the second response masks the same session token anew.
    expect(record(record(parsed(await second.text())).shared).csrf).not.toBe(masked);
    expect(readdirSync(directory)).toEqual([cookie.slice('hy-session='.length, cookie.indexOf(';'))]);
  });

  it('creates no session for a path without a route (HY-45)', async () => {
    await start();
    const response = await fetch(`${base}/missing`);
    expect(response.status).toBe(404);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(readdirSync(directory)).toEqual([]);
  });

  it('marks the session cookie Secure when the application declares HTTPS (HY-45)', async () => {
    await start({ https: true });
    expect((await fetch(`${base}/`)).headers.get('set-cookie')).toMatch(/; path=\/; secure; HttpOnly; SameSite=Lax$/);
  });

  it('answers a request target with a byte outside ASCII with a plain 400 (HY-42)', async () => {
    await start();
    const response = await raw(Buffer.concat([Buffer.from('GET /items/'), Buffer.from('한'), Buffer.from(' HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n')]));
    expect(response.startsWith('HTTP/1.1 400 Bad Request\r\n')).toBe(true);
    expect(response).toContain("Content-Security-Policy: frame-ancestors 'self'\r\n");
    expect(response).toContain('Content-Type: text/plain; charset=utf-8\r\n');
    // HY-65: no cache stores the failure.
    expect(response).toContain('Cache-Control: no-store\r\n');
    expect(response.endsWith('\r\n\r\nBad Request')).toBe(true);
    // HY-60: the response that node:http does not give to the application is reported with its request line.
    expect(reports.map((report) => report.slice(0, 2))).toEqual([[`GET /items/${Buffer.from('한').toString('latin1')}`, 400]]);
    expect(present(reports[0])[2]).toBeGreaterThanOrEqual(0);
    expect((await raw(Buffer.from('\x01\r\n\r\n'))).startsWith('HTTP/1.1 400 ')).toBe(true);
    expect(present(reports[1]).slice(0, 2)).toEqual([null, 400]);
    // HY-60: a response that node:http does not give to the application has an empty reply.
    expect(reports.map((report) => report[3])).toEqual([0, 0]);
  });

  it('answers a body larger than the limit of the application with 413 (HY-59)', async () => {
    await start({ bodyLimit: 10 });
    const response = await fetch(`${base}/add`, { method: 'POST', body: new URLSearchParams({ name: 'a'.repeat(20) }) });
    expect(response.status).toBe(413);
    expect(await response.text()).toBe('Content Too Large');
    expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'self'");
    expect(response.headers.get('cache-control')).toBe('no-store');
    // A body without Content-Length is counted while it is read.
    const chunked = await raw(Buffer.from('POST /add HTTP/1.1\r\nHost: x\r\nConnection: close\r\nTransfer-Encoding: chunked\r\nContent-Type: text/plain\r\n\r\n8\r\n12345678\r\n8\r\n12345678\r\n0\r\n\r\n'));
    expect(chunked.startsWith('HTTP/1.1 413 ')).toBe(true);
    expect(reports.map((report) => report.slice(0, 2))).toEqual([['POST /add', 413], ['POST /add', 413]]);
    expect(readdirSync(directory)).toEqual([]);
  });

  it('sends no Content-Type without a body and one Cache-Control for a page (HY-52)', async () => {
    await start();
    // The document of /list?embed=1 embeds the data of its route region, including the shared CSRF token (HY-31, HY-92).
    const first = await fetch(`${base}/list?embed=1`);
    const cookie = present(present(first.headers.get('set-cookie')).split(';')[0]);
    const token = present(present(/"csrf":"([0-9a-f]+)"/.exec(await first.text()))[1]);
    expect(first.headers.get('cache-control')).toBe('no-store');
    const kept = await fetch(`${base}/_hyper/keep`, { method: 'POST', headers: { Cookie: cookie }, body: new URLSearchParams({ _csrf: token, region: 'rows', path: 'open', value: 'true' }) });
    expect(kept.status).toBe(204);
    expect(kept.headers.get('content-type')).toBeNull();
    const redirect = await fetch(`${base}/add`, { method: 'POST', redirect: 'manual', headers: { Cookie: cookie }, body: new URLSearchParams({ _csrf: token, name: 'a' }) });
    expect(redirect.status).toBe(303);
    expect(redirect.headers.get('location')).toBe('/');
    expect(redirect.headers.get('content-type')).toBeNull();
  });

  it('serves the files of a public directory and sends other paths to the application', async () => {
    const app = await new Fixture().app();
    server = app.server(new FileSessions({ directory }), { files: FIXTURES });
    base = await listen(server);
    const file = await fetch(`${base}/app.json`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await file.text()).toBe(readFileSync(`${FIXTURES}app.json`, 'utf8'));
    expect((await fetch(`${base}/templates`)).status).toBe(404);
    expect((await raw(Buffer.from('GET /../package.json HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'))).startsWith('HTTP/1.1 404 ')).toBe(true);
    expect((await fetch(`${base}/app.json`, { method: 'POST' })).status).toBe(404);
  });

  it('logs an unhandled error and answers with a plain 500 (HY-43)', async () => {
    await start();
    const response = await fetch(`${base}/items/broken`);
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Internal Server Error');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('reports the 500 of a handler failure to the response hook with its request (HY-43, HY-60)', async () => {
    await start();
    expect((await fetch(`${base}/items/broken`)).status).toBe(500);
    expect(reports.map((report) => report.slice(0, 2))).toEqual([['GET /items/broken', 500]]);
  });

  it('answers a plain 500 for an error that the response hook throws, logs it and calls no further hook (HY-60)', async () => {
    const logged: string[] = [];
    const calls: string[] = [];
    const app = await new Fixture().app({
      log: (message) => logged.push(message),
      onResponse: (request) => {
        calls.push(request === null ? 'null' : `${request.method} ${request.path()}`);
        throw new Error('hook boom');
      },
    });
    server = app.server(new FileSessions({ directory }));
    base = await listen(server);
    // The plain 500 of an escaped error is hyper's own response (HY-60); the response hook does not receive it.
    const response = await fetch(`${base}/list`);
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Internal Server Error');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'self'");
    expect(calls).toEqual(['GET /list']);
    expect(logged.filter((line) => line.startsWith('hyper: Error: hook boom'))).toHaveLength(1);
  });

  it('reports the plain 500 of an escaped error to the write events of its response with its request (HY-60, HY-99)', async () => {
    const app = await new Fixture().app({
      onResponse: () => {
        throw new Error('hook boom');
      },
    });
    server = app.server(new FileSessions({ directory }));
    // The write events of the node:http response are the write hook of the Node server (HY-99): a listener that runs
    // before the server's own listener receives the end of the write of the 500 with its request.
    const writes: Promise<string>[] = [];
    server.prependListener('request', (incoming, outgoing) => {
      writes.push(new Promise((resolve) => outgoing.on('finish', () => resolve(`${incoming.method} ${incoming.url} ${outgoing.statusCode}`))));
    });
    base = await listen(server);
    expect((await fetch(`${base}/list`)).status).toBe(500);
    expect(await Promise.all(writes)).toEqual(['GET /list 500']);
  });

  it('answers a request with headers larger than node:http accepts with a 431 that no cache stores (HY-65)', async () => {
    await start();
    const response = await raw(Buffer.from(`GET / HTTP/1.1\r\nHost: x\r\nX-Large: ${'a'.repeat(20000)}\r\nConnection: close\r\n\r\n`));
    expect(response.startsWith('HTTP/1.1 431 ')).toBe(true);
    expect(response).toContain('Cache-Control: no-store\r\n');
  });

  it('stops a request whose client closes the connection and calls the disconnect hook (HY-67)', async () => {
    const calls: string[] = [];
    const responses: number[] = [];
    const disconnects: [string, boolean, Record<string, unknown>][] = [];
    const closed = latch();
    // The first request waits inside its shared handler until the server has seen its connection close, so the
    // order of the events does not depend on the time that any step takes.
    const entered = latch();
    const released = latch();
    const app = await new Fixture().app({
      handlers: {
        ...handlers(),
        shared: async ({ reply }) => {
          calls.push('shared');
          reply.note('stage', 'shared');
          if (calls.length === 1) {
            entered.open();
            await released.opened;
          }
          return {};
        },
        regions: { side: () => (calls.push('side'), { count: 0, note: null }) },
      },
      onResponse: (_request, response) => responses.push(response.status),
      onDisconnect: (request, elapsed, reply) => {
        disconnects.push([`${request.method} ${request.path()}`, elapsed > 0, Object.fromEntries(reply.notes())]);
        closed.open();
      },
    });
    server = app.server(new FileSessions({ directory }));
    await dropClient(server, entered.opened, released.open);
    await closed.opened;
    expect(disconnects).toEqual([['GET /', true, { stage: 'shared' }]]);
    expect(calls).toEqual(['shared']);
    expect(responses).toEqual([]);
    // A request whose client stays receives its response and calls no disconnect hook.
    base = `http://127.0.0.1:${port(server)}`;
    expect((await fetch(`${base}/`)).status).toBe(200);
    expect(disconnects.length).toBe(1);
    expect(responses).toEqual([200]);
  });
});

// The write hook of the Node server (HY-99) and the listener that App.listener returns (HY-100).
describe('the write hook and App.listener', () => {
  type Written = [string, number | null, boolean, string | null];

  it('App.listener returns the request listener of the application (HY-100)', async () => {
    const app = await new Fixture().app();
    const listener = app.listener(new FileSessions({ directory }));
    expect(typeof listener).toBe('function');
    // A node:http server that installs only this listener answers the application.
    const plain = createHttpServer(listener);
    const plainBase = await listen(plain);
    const response = await fetch(`${plainBase}/`);
    await new Promise((resolve) => plain.close(resolve));
    expect(response.status).toBe(200);
  });

  it('calls the write hook once after the close of the response, with the response that it wrote and ended true (HY-99)', async () => {
    const written: Written[] = [];
    const app = await new Fixture().app();
    server = app.server(new FileSessions({ directory }), {
      written: (request, response, ended, elapsed, failure) => {
        expect(elapsed).toBeGreaterThanOrEqual(0);
        written.push([`${request.method} ${request.path()}`, response?.status ?? null, ended, failure]);
      },
    });
    base = await listen(server);
    expect((await fetch(`${base}/`)).status).toBe(200);
    // The hook runs after the close of the response, which may come after the client has read the response.
    await vi.waitFor(() => expect(written).toEqual([['GET /', 200, true, null]]));
  });

  it('reports the plain 500 of an escaped error once with ended true and its failure, and keeps a header set before the listener (HY-60, HY-99)', async () => {
    const written: Written[] = [];
    const app = await new Fixture().app({
      onResponse: () => {
        throw new Error('hook boom');
      },
    });
    server = app.server(new FileSessions({ directory }), {
      written: (request, response, ended, _elapsed, failure) => written.push([`${request.method} ${request.path()}`, response?.status ?? null, ended, failure]),
    });
    // A header that the caller sets before the listener of hyper runs stays on the plain 500 (HY-60).
    server.prependListener('request', (_incoming, outgoing) => outgoing.setHeader('X-Before', 'kept'));
    base = await listen(server);
    const response = await fetch(`${base}/list`);
    expect(response.status).toBe(500);
    expect(response.headers.get('x-before')).toBe('kept');
    await vi.waitFor(() => expect(written).toEqual([['GET /list', 500, true, 'hook boom']]));
  });

  it('calls the write hook with ended false before the disconnect hook when the client closes the connection (HY-67, HY-99)', async () => {
    const events: string[] = [];
    const { app, running, release } = await waitingApp(events);
    server = app.server(new FileSessions({ directory }), {
      written: (request, response, ended, _elapsed, failure) => events.push(`written ${request.method} ${request.path()} ${response === null ? 'null' : response.status} ${ended} ${failure}`),
    });
    await dropClient(server, running, release);
    // The listener settles after the write hook and the disconnect hook (HY-100).
    await vi.waitFor(() => expect(events).toHaveLength(2));
    // HY-99: a request whose connection closed before its answer started has no response.
    expect(events).toEqual(['written GET / null false null', 'disconnect GET /']);
  });

  it('settles the promise of the listener after the write hook and the disconnect hook (HY-100)', async () => {
    const events: string[] = [];
    const { app, running, release } = await waitingApp(events);
    const sessions = new FileSessions({ directory });
    const listener = app.listener(sessions, {
      written: (request, response, ended) => events.push(`written ${request.method} ${request.path()} ${response === null ? 'null' : response.status} ${ended}`),
    });
    const settled: Promise<void>[] = [];
    const plain = createHttpServer((incoming, outgoing) => {
      settled.push(listener(incoming, outgoing).then(() => void events.push('settled')));
    });
    await dropClient(plain, running, release);
    await Promise.all(settled);
    await new Promise((resolve) => plain.close(resolve));
    expect(events).toEqual(['written GET / null false', 'disconnect GET /', 'settled']);
  });
});

// The request hook around (HY-97), the same cases as the Python server.
describe('the request hook around', () => {
  it('runs the application for the request that around passes to answer, and sends the response that around returns (HY-97)', async () => {
    const calls: string[] = [];
    const app = await new Fixture().app();
    server = app.server(new FileSessions({ directory }), {
      around: async (request, answer) => {
        calls.push(`${request.method} ${request.path()}`);
        const response = await answer(request);
        return response.withHeader('X-Around', 'yes');
      },
    });
    base = await listen(server);
    const response = await fetch(`${base}/items/7`);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-around')).toBe('yes');
    expect(await response.text()).toContain('<i>7</i>');
    expect(calls).toEqual(['GET /items/7']);
  });

  it('answers a changed copy of the request, such as a copy with a header (HY-97)', async () => {
    const app = await new Fixture().app();
    server = app.server(new FileSessions({ directory }), { around: (request, answer) => answer(request.withHeader('Accept', 'application/json')) });
    base = await listen(server);
    const response = await fetch(`${base}/items/7`);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(record(parsed(await response.text())).route).toBe('item');
  });

  it('sends the response of around alone and opens no session and runs no loader, action or hook of the application (HY-97)', async () => {
    const fixture = new Fixture();
    const reports: number[] = [];
    const app = await fixture.app({ onResponse: (_request, response) => reports.push(response.status) });
    server = app.server(new FileSessions({ directory }), { around: () => Response.text(418, 'alone') });
    base = await listen(server);
    const response = await fetch(`${base}/`);
    expect(response.status).toBe(418);
    expect(await response.text()).toBe('alone');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(readdirSync(directory)).toEqual([]);
    expect(reports).toEqual([]);
  });

  it('answers the plain 500 for an error of around and for a return value that is no response, and reports it to the write hook (HY-97, HY-60)', async () => {
    const written: [number | null, boolean, string | null][] = [];
    const fixture = new Fixture();
    const app = await fixture.app();
    for (const around of [
      () => {
        throw new Error('around boom');
      },
      // @ts-expect-error: the hook returns a value that is no Response, which the server checks at run time.
      () => 'not a response',
    ]) {
      server = app.server(new FileSessions({ directory }), { around, written: (_request, response, ended, _elapsed, failure) => written.push([response?.status ?? null, ended, failure]) });
      base = await listen(server);
      const response = await fetch(`${base}/`);
      expect(response.status).toBe(500);
      expect(await response.text()).toBe('Internal Server Error');
      await new Promise((resolve) => server.close(resolve));
    }
    await vi.waitFor(() => expect(written).toHaveLength(2));
    expect(written[0]).toEqual([500, true, 'around boom']);
    expect(written[1]?.slice(0, 2)).toEqual([500, true]);
    // The next afterEach closes the server of the last case; start one that it can close.
    server = createHttpServer();
    await listen(server);
  });

  it('fails when the hook is not a function (HY-97)', async () => {
    const app = await new Fixture().app();
    // @ts-expect-error: a string is no hook, which the server checks at run time.
    expect(() => app.server(new FileSessions({ directory }), { around: 'hook' })).toThrow('the request hook must be a function');
    server = createHttpServer();
    await listen(server);
  });

  it('calls the disconnect hook with the request and the reply of the last call of answer, and not when around never called answer (HY-97, HY-67)', async () => {
    const events: string[] = [];
    const { app, running, release } = await waitingApp(events);
    const seen: string[] = [];
    server = app.server(new FileSessions({ directory }), {
      around: (request, answer) => {
        seen.push(request.header('X-Mark') ?? 'none');
        return answer(request.withHeader('X-Mark', 'changed'));
      },
      written: (request, _response, ended) => events.push(`written ${request.header('X-Mark') ?? 'none'} ${ended}`),
    });
    await dropClient(server, running, release);
    await vi.waitFor(() => expect(events).toHaveLength(2));
    expect(events).toEqual(['written none false', 'disconnect GET /']);
    expect(seen).toEqual(['none']);
  });
});
