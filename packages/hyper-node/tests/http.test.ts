// The HTTP server of an application with sessions in files (HY-42, HY-43, HY-45, HY-52, HY-54).
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSessions } from '../src/index.js';
import { Fixture, FIXTURES } from './support.js';

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
  server = app.server(new FileSessions({ directory, name: 'PHPSESSID' }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
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
    const port = (server.address() as AddressInfo).port;
    const socket = connect(port, '127.0.0.1', () => socket.write(bytes));
    let text = '';
    socket.on('data', (chunk) => (text += chunk.toString('latin1')));
    socket.on('end', () => resolve(text));
  });
}

describe('App.server', () => {
  it('sets the session cookie of a new session and keeps the session (HY-45)', async () => {
    await start();
    const first = await fetch(`${base}/`, { headers: { Accept: 'application/json' } });
    const cookie = first.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^PHPSESSID=[0-9a-f]{64}; path=\/; HttpOnly; SameSite=Lax$/);
    const token = ((await first.json()) as { shared: { csrf: string } }).shared.csrf;
    const second = await fetch(`${base}/`, { headers: { Accept: 'application/json', Cookie: cookie.split(';')[0]! } });
    expect(second.headers.get('set-cookie')).toBeNull();
    expect(((await second.json()) as { shared: { csrf: string } }).shared.csrf).toBe(token);
    expect(readdirSync(directory)).toEqual([cookie.slice('PHPSESSID='.length, cookie.indexOf(';'))]);
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
    expect(reports[0]![2]).toBeGreaterThanOrEqual(0);
    expect((await raw(Buffer.from('\x01\r\n\r\n'))).startsWith('HTTP/1.1 400 ')).toBe(true);
    expect(reports[1]!.slice(0, 2)).toEqual([null, 400]);
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
    const first = await fetch(`${base}/`);
    const cookie = first.headers.get('set-cookie')!.split(';')[0]!;
    const token = /"csrf":"([0-9a-f]+)"/.exec(await first.text())![1]!;
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
    server = app.server(new FileSessions({ directory, name: 'PHPSESSID' }), { files: FIXTURES });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
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

  it('answers a request with headers larger than node:http accepts with a 431 that no cache stores (HY-65)', async () => {
    await start();
    const response = await raw(Buffer.from(`GET / HTTP/1.1\r\nHost: x\r\nX-Large: ${'a'.repeat(20000)}\r\nConnection: close\r\n\r\n`));
    expect(response.startsWith('HTTP/1.1 431 ')).toBe(true);
    expect(response).toContain('Cache-Control: no-store\r\n');
  });
});
