// The PHP, Node and Python servers read an upload over HTTP alike (HY-131): `App::run` of PHP under its built-in
// server, the server of `App.server` of Node and the `http.server` server of Python are real processes with one
// application, whose request hook answers what the request gave of its body. The same requests must give the same
// answers, a file that the hook moved must hold the bytes that were sent, and the directory of a request must be gone
// when the connection of the request has ended. The Node server ends a connection before it removes the directory, so
// its removal is tested where the end of its listener is known (packages/server/ts/tests/http.test.ts).
import assert from 'node:assert/strict';
import { type ChildProcess, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { startPhp, startServer, stopServers } from '../../scripts/board-servers.mts';
import { requireBuilt } from './requires.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = path.join(ROOT, 'tests/scripts/fixtures/upload-server');
const PYTHON = path.join(ROOT, 'packages/server/python/.venv/bin/python');
const READY = /upload on (http:\/\/127\.0\.0\.1:\d+)/;
const LIMIT = 16 * 1024 * 1024;
const BOUNDARY = 'UploadXyZ';
const SERVERS = ['php', 'node', 'python'] as const;

// Sends one request with `Connection: close` and resolves with the status and the body when the server has closed the
// connection, which PHP and the `http.server` server do after the request has ended.
function send(url: string, method: string, headers: Record<string, string>, body: Buffer): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const { hostname, port } = new URL(url);
    const socket = connect(Number(port), hostname);
    const chunks: Buffer[] = [];
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.on('error', reject);
    socket.on('end', () => {
      const response = Buffer.concat(chunks).toString('latin1');
      const head = response.indexOf('\r\n\r\n');
      const status = /^HTTP\/1\.[01] (\d{3})/.exec(response);
      if (head < 0 || status === null) reject(new Error(`the server answered ${response.slice(0, 200)}`));
      else resolve({ status: Number(status[1]), body: Buffer.from(response.slice(head + 4), 'latin1').toString('utf8') });
    });
    const lines = [`${method} / HTTP/1.1`, `Host: ${hostname}:${port}`, 'Connection: close', `Content-Length: ${body.length}`, ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`)];
    socket.write(Buffer.concat([Buffer.from(`${lines.join('\r\n')}\r\n\r\n`), body]));
  });
}

const part = (disposition: string, content: Buffer): Buffer => Buffer.concat([Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: ${disposition}\r\n\r\n`), content, Buffer.from('\r\n')]);

test('the three servers read an upload over HTTP alike and remove its directory (HY-131)', { timeout: 300_000 }, async (t) => {
  requireBuilt('packages', 'packages/server/ts/dist/index.js');
  requireBuilt('hyper-install-python', 'packages/server/python/.venv/bin/python');
  requireBuilt('hyper-install-php', 'vendor/autoload.php');
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-upload-servers-'));
  const children: ChildProcess[] = [];
  t.after(async () => {
    await stopServers(children);
    rmSync(directory, { recursive: true, force: true });
  });
  // The application of the three servers, built as the applications of the contract cases are.
  await promisify(execFile)(process.execPath, [
    path.join(ROOT, 'scripts/contract-programs.mjs'),
    '--contract', path.join(FIXTURE, 'application.json'),
    '--reads', path.join(FIXTURE, 'reads.json'),
    '--output', path.join(directory, 'applications'),
  ], { cwd: ROOT });
  const environment = (server: string): Record<string, string> => {
    for (const name of ['tmp', 'moved', 'sessions']) mkdirSync(path.join(directory, server, name), { recursive: true });
    return {
      UPLOAD_APP: path.join(directory, 'applications/upload'),
      UPLOAD_MOVED: path.join(directory, server, 'moved'),
      UPLOAD_SESSIONS: path.join(directory, server, 'sessions'),
      UPLOAD_LIMIT: String(LIMIT),
      TMPDIR: path.join(directory, server, 'tmp'),
    };
  };
  const urls = {
    php: (await startPhp({ name: 'php', app: FIXTURE, port: 0, env: environment('php'), ini: ['enable_post_data_reading=0', 'post_max_size=64M', `session.save_path=${path.join(directory, 'php/sessions')}`], children })).url,
    node: (await startServer({ name: 'node', command: process.execPath, args: ['--no-warnings', path.join(FIXTURE, 'server.mjs')], env: { ...process.env, ...environment('node') }, ready: READY, children })).url,
    python: (await startServer({ name: 'python', command: PYTHON, args: [path.join(FIXTURE, 'server.py')], env: { ...process.env, ...environment('python') }, ready: READY, children })).url,
  };

  // A file of 3 MiB whose bytes are a pattern, so that a part that is lost or moved changes its digest.
  const content = Buffer.alloc(3 * 1024 * 1024);
  for (let index = 0; index < content.length; index += 1) content[index] = (index * 31 + (index >> 8)) & 0xff;
  const upload = Buffer.concat([
    part('form-data; name="a"', Buffer.from('1')),
    part('form-data; name="tags[]"', Buffer.from('x')),
    part('form-data; name="f"; filename="큰 파일.bin"', content),
    part('form-data; name="tags[]"', Buffer.from('y')),
    part('form-data; name="f"; filename=""', Buffer.alloc(0)),
    Buffer.from(`--${BOUNDARY}--\r\n`),
  ]);
  const multipart = { 'Content-Type': `multipart/form-data; boundary=${BOUNDARY}` };
  const digest = createHash('sha256').update(content).digest('hex');
  const empty = createHash('sha256').update('').digest('hex');
  const requests: { label: string; headers: Record<string, string>; body: Buffer; status: number; answer: unknown }[] = [
    { label: 'an upload of a file of 3 MiB', headers: multipart, body: upload, status: 200, answer: { valid: true, form: [['a', ['1']], ['tags[]', ['x', 'y']]], files: [['f', '큰 파일.bin', '', content.length, digest], ['f', '', '', 0, empty]], held: 1 } },
    { label: 'a body without its closing delimiter', headers: multipart, body: upload.subarray(0, upload.length - 4), status: 200, answer: { valid: false, form: [], files: [], held: 1 } },
    { label: 'a form body', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: Buffer.from('a=1&a=2'), status: 200, answer: { valid: true, form: [['a', ['1', '2']]], files: [], held: 0 } },
    { label: 'a request without a body', headers: {}, body: Buffer.alloc(0), status: 200, answer: { valid: true, form: [], files: [], held: 0 } },
  ];
  for (const request of requests) {
    for (const server of SERVERS) {
      const response = await send(urls[server], 'POST', request.headers, request.body);
      assert.equal(response.status, request.status, `${server}, ${request.label}: ${response.body.slice(0, 200)}`);
      assert.deepEqual(JSON.parse(response.body), request.answer, `${server}, ${request.label}`);
      assert.deepEqual(readdirSync(path.join(directory, server, 'moved')), [], `${server}, ${request.label}: a moved file stays`);
      if (server !== 'node') assert.deepEqual(readdirSync(path.join(directory, server, 'tmp')).filter((name) => name.startsWith('hyper-')), [], `${server}, ${request.label}: the directory of the request stays`);
    }
  }
});
