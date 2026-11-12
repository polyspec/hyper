// The HTTP server of an application with sessions in files (HY-42, HY-43, HY-45, HY-52, HY-54).
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer as createHttpServer, type Server } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSessions, Response } from '../src/index.js';
import { Fixture, handlers, port, present } from './support.js';

let directory: string;
let server: Server;
let base: string;

let reports: [string | null, number, number, number][];

async function start(options: { https?: boolean; bodyLimit?: number } = {}): Promise<void> {
  reports = [];
  const app = await new Fixture().app({
    https: options.https ?? false,
    ...(options.bodyLimit === undefined ? {} : { bodyLimit: options.bodyLimit }),
    onResponse: (request, response, elapsed, reply) => reports.push([request === null ? null : `${request.method} ${request.path()}`, response.status, elapsed, reply.notes().length]),
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
async function waitingApp(events: string[]): Promise<{ app: Awaited<ReturnType<Fixture['app']>>; running: Promise<void>; release: () => void }> {
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
});

// The write hook of the Node server (HY-99) and the listener that App.listener returns (HY-100).
describe('the write hook and App.listener', () => {
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

// A multipart body that the server reads in chunks (HY-131), the same cases as the Python transports.
describe('a multipart body read in chunks', () => {
  const part = (disposition: string, content: Buffer): Buffer => Buffer.concat([Buffer.from(`--XyZ\r\nContent-Disposition: ${disposition}\r\n\r\n`), content, Buffer.from('\r\n')]);

  // Runs the server with the temporary directory `uploads` and one request with the body, and returns what around saw
  // and the entries of `uploads` at the write hook and after the removal that follows it.
  async function upload(body: Buffer, move: boolean): Promise<{ status: number; seen: unknown[]; atHook: string[]; after: string[] }> {
    const uploads = mkdtempSync(join(tmpdir(), 'hyper-uploads-'));
    const previous = process.env['TMPDIR'];
    process.env['TMPDIR'] = uploads;
    try {
      const seen: unknown[] = [];
      let atHook: string[] = [];
      // The end of the listener of the request, which follows the removal of the directory.
      let handled: Promise<void> = Promise.resolve();
      const app = await new Fixture().app({ formTypes: ['application/x-www-form-urlencoded', 'multipart/form-data'], bodyLimit: 4 * 1024 * 1024 });
      const listener = app.listener(new FileSessions({ directory }), {
        around: (request) => {
          const file = request.file('f');
          seen.push(request.validInput(), request.form(), file?.filename() ?? null, file?.size() ?? null, readdirSync(uploads).length);
          if (move) file?.moveTo(join(uploads, 'kept.bin'));
          return Promise.resolve(Response.text(200, 'stored'));
        },
        written: () => {
          atHook = readdirSync(uploads).map((name) => (name.startsWith('hyper-') ? 'hyper-' : name)).sort();
        },
      });
      server = createHttpServer((incoming, outgoing) => {
        handled = listener(incoming, outgoing);
      });
      base = await listen(server);
      const response = await fetch(`${base}/upload`, { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=XyZ' }, body: new Uint8Array(body) });
      await response.text();
      // The listener ends after the write hook and the removal of the directory, which waits for the files to close.
      await handled;
      return { status: response.status, seen, atHook, after: readdirSync(uploads) };
    } finally {
      if (previous === undefined) delete process.env['TMPDIR'];
      else process.env['TMPDIR'] = previous;
      rmSync(uploads, { recursive: true, force: true });
    }
  }

  it('gives a file of 1.5 MiB from a file of the request, and removes the directory after the write hook (HY-131.13, HY-131.14)', async () => {
    const content = Buffer.alloc(1_500_000, 'x');
    const body = Buffer.concat([part('form-data; name="a"', Buffer.from('1')), part('form-data; name="f"; filename="big.bin"', content), Buffer.from('--XyZ--\r\n')]);
    const result = await upload(body, true);
    expect(result.status).toBe(200);
    expect(result.seen).toEqual([true, [['a', ['1']]], 'big.bin', 1_500_000, 1]);
    // At the write hook the directory of the request is there with the moved file beside it; then only the moved file.
    expect(result.atHook).toEqual(['hyper-', 'kept.bin']);
    expect(result.after).toEqual(['kept.bin']);
  });

  it('removes the directory of a body without its closing delimiter, whose input is not valid (HY-131.5)', async () => {
    const body = part('form-data; name="f"; filename="cut.bin"', Buffer.alloc(200_000, 'y'));
    const result = await upload(body, false);
    expect(result.seen).toEqual([false, [], null, null, 1]);
    expect(result.after).toEqual([]);
  });
});
