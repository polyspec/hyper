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
import { test, type TestContext } from 'node:test';
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
function send(url: string, method: string, headers: Record<string, string>, body: Buffer, target = '/'): Promise<{ status: number; body: string; headers: Record<string, string> }> {
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
      else {
        // The header lines by their lower-case names, each with its last value.
        const lines = response.slice(0, head).split('\r\n').slice(1).map((line): [string, string] => [line.slice(0, line.indexOf(':')).toLowerCase(), line.slice(line.indexOf(':') + 1).trim()]);
        resolve({ status: Number(status[1]), body: Buffer.from(response.slice(head + 4), 'latin1').toString('utf8'), headers: Object.fromEntries(lines) });
      }
    });
    const lines = [`${method} ${target} HTTP/1.1`, `Host: ${hostname}:${port}`, 'Connection: close', `Content-Length: ${body.length}`, ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`)];
    socket.write(Buffer.concat([Buffer.from(`${lines.join('\r\n')}\r\n\r\n`), body]));
  });
}

// Starts a run: its directory with the application of the servers, built as the applications of the contract cases
// are, its children, which the end of the test stops before it removes the directory, and the environment of a server
// with directories of its own.
async function started(t: TestContext): Promise<{ directory: string; children: ChildProcess[]; environment: (server: string) => Record<string, string> }> {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-upload-servers-'));
  const children: ChildProcess[] = [];
  t.after(async () => {
    await stopServers(children);
    rmSync(directory, { recursive: true, force: true });
  });
  await promisify(execFile)(process.execPath, [
    path.join(ROOT, 'scripts/contract-programs.mts'),
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
  return { directory, children, environment };
}

const part = (disposition: string, content: Buffer): Buffer => Buffer.concat([Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: ${disposition}\r\n\r\n`), content, Buffer.from('\r\n')]);

test('the three servers read an upload over HTTP alike and remove its directory (HY-131)', { timeout: 300_000 }, async (t) => {
  requireBuilt('packages', 'packages/server/ts/dist/index.js');
  requireBuilt('hyper-install-python', 'packages/server/python/.venv/bin/python');
  requireBuilt('hyper-install-php', 'vendor/autoload.php');
  const { directory, children, environment } = await started(t);
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

test('App::run of PHP fails under a server when PHP reads the request body itself (HY-59.9)', { timeout: 120_000 }, async (t) => {
  requireBuilt('hyper-install-php', 'vendor/autoload.php');
  const { children, environment } = await started(t);
  const env = { ...environment('php'), UPLOAD_FORMS: 'urlencoded' };
  // The application accepts no multipart body, and the two servers differ only in the setting, so the 500 of the first
  // is the refusal of `App::run` for a SAPI that serves requests.
  const reading = await startPhp({ name: 'php-reading', app: FIXTURE, port: 0, env, ini: ['post_max_size=64M', 'enable_post_data_reading=1', 'log_errors=0'], children });
  const refused = await send(reading.url, 'GET', {}, Buffer.alloc(0));
  assert.equal(refused.status, 500, 'the application answered although PHP reads the request body itself');
  const left = await startPhp({ name: 'php-left', app: FIXTURE, port: 0, env, ini: ['post_max_size=64M', 'log_errors=0'], children });
  assert.equal((await send(left.url, 'GET', {}, Buffer.alloc(0))).status, 200);
});

test('the three servers answer a page and a representation over HTTP alike, a HEAD without a body (HY-27, HY-121, HY-122)', { timeout: 300_000 }, async (t) => {
  requireBuilt('packages', 'packages/server/ts/dist/index.js');
  requireBuilt('hyper-install-python', 'packages/server/python/.venv/bin/python');
  requireBuilt('hyper-install-php', 'vendor/autoload.php');
  const { directory, children, environment } = await started(t);
  const env = (server: string): Record<string, string> => ({ ...environment(server), UPLOAD_ANSWER: 'app' });
  const urls = {
    php: (await startPhp({ name: 'php', app: FIXTURE, port: 0, env: env('php'), ini: ['enable_post_data_reading=0', 'post_max_size=64M', `session.save_path=${path.join(directory, 'php/sessions')}`], children })).url,
    node: (await startServer({ name: 'node', command: process.execPath, args: ['--no-warnings', path.join(FIXTURE, 'server.mjs')], env: { ...process.env, ...env('node') }, ready: READY, children })).url,
    python: (await startServer({ name: 'python', command: PYTHON, args: [path.join(FIXTURE, 'server.py')], env: { ...process.env, ...env('python') }, ready: READY, children })).url,
  };
  const ITEM = 'application/vnd.example.item+json';
  const none = Buffer.alloc(0);
  // What the three servers must answer alike: the status, the body and the headers that the application decides.
  const NAMES = ['content-type', 'etag', 'allow', 'vary', 'cache-control'];
  const answered = async (method: string, target: string, headers: Record<string, string>, body = none): Promise<Record<string, { status: number; body: string; headers: Record<string, string> }>> => {
    const answers: Record<string, { status: number; body: string; headers: Record<string, string> }> = {};
    for (const server of SERVERS) answers[server] = await send(urls[server], method, headers, body, target);
    const seen = (server: string): unknown => {
      const answer = answers[server];
      return { status: answer?.status, body: answer?.body, headers: NAMES.map((name) => [name, answer?.headers[name]]) };
    };
    for (const server of SERVERS) assert.deepEqual(seen(server), seen('php'), `${server} answers ${method} ${target} as php does`);
    return answers;
  };

  // HY-27.4, HY-27.5: a HEAD of a page has the status and the headers of its GET, the Content-Length of that body and
  // no body.
  const page = await answered('GET', '/', {});
  const pageHead = await answered('HEAD', '/', {});
  for (const server of SERVERS) {
    assert.equal(page[server]?.status, 200);
    assert.match(page[server]?.body ?? '', /<p>upload<\/p>/);
    assert.equal(pageHead[server]?.status, 200, server);
    assert.equal(pageHead[server]?.body, '', `${server} wrote a body for HEAD`);
    assert.equal(pageHead[server]?.headers['content-type'], 'text/html; charset=utf-8', server);
    assert.equal(pageHead[server]?.headers['content-length'], String(Buffer.byteLength(page[server]?.body ?? '')), `${server} Content-Length of HEAD`);
  }

  // HY-122: a representation, its strong tag, the HEAD of it and the 304 of a request that names the tag.
  const item = await answered('GET', '/items/7', { Accept: ITEM });
  const text = '{"id":"7","title":"é"}';
  const tag = `"${createHash('sha256').update(`${ITEM}\n${text}`).digest('hex').slice(0, 32)}"`;
  const itemHead = await answered('HEAD', '/items/7', { Accept: ITEM });
  const unchanged = await answered('GET', '/items/7', { Accept: ITEM, 'If-None-Match': tag });
  const unchangedHead = await answered('HEAD', '/items/7', { Accept: ITEM, 'If-None-Match': tag });
  for (const server of SERVERS) {
    assert.deepEqual([item[server]?.status, item[server]?.body, item[server]?.headers.etag, item[server]?.headers['content-type']], [200, text, tag, ITEM], server);
    assert.equal(item[server]?.headers['set-cookie'], undefined, `${server} set a cookie for a representation`);
    assert.deepEqual([itemHead[server]?.status, itemHead[server]?.body, itemHead[server]?.headers.etag, itemHead[server]?.headers['content-length']], [200, '', tag, String(Buffer.byteLength(text))], server);
    for (const answer of [unchanged[server], unchangedHead[server]]) {
      assert.deepEqual([answer?.status, answer?.body, answer?.headers.etag, answer?.headers['content-type']], [304, '', tag, undefined], server);
    }
  }

  // HY-121: a PUT gives its handler the JSON value of its body, which the handler answers; another method is refused
  // with the methods of the entry.
  const sent = '{"title":"새 제목","n":[1,2.5,null],"empty":{}}';
  const put = await answered('PUT', '/items/7', { Accept: ITEM, 'Content-Type': 'application/json' }, Buffer.from(sent));
  const refused = await answered('DELETE', '/items/7', { Accept: ITEM });
  const refusedHead = await answered('HEAD', '/', { Accept: 'application/xml' });
  for (const server of SERVERS) {
    assert.deepEqual([put[server]?.status, put[server]?.body, put[server]?.headers.etag], [200, sent, undefined], server);
    assert.deepEqual([refused[server]?.status, refused[server]?.headers.allow, refused[server]?.body], [405, 'GET, HEAD, PUT', 'Method Not Allowed'], server);
    assert.deepEqual([refusedHead[server]?.status, refusedHead[server]?.body, refusedHead[server]?.headers['content-length']], [406, '', String(Buffer.byteLength('text/html\napplication/vnd.hyper+json\n'))], server);
  }
});
