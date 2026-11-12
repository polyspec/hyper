// The PHP, Node and Python servers read an upload over HTTP alike (HY-131): `App::run` of PHP under its built-in
// server, the server of `App.server` of Node and the `http.server` server of Python are real processes with one
// application, whose request hook answers what the request gave of its body. The same requests must give the same
// answers, a file that the hook moved must hold the bytes that were sent, and the directory of a request must be gone
// when the connection of the request has ended. The Node server ends a connection before it removes the directory, so
// its removal is tested where the end of its listener is known (packages/ts/tests/http.test.ts).
import assert from 'node:assert/strict';
import { type ChildProcess, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, promisify } from 'node:util';

import { startPhp, startServer, stopServers } from '../../scripts/board-servers.mts';
import { requireBuilt } from './requires.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = path.join(ROOT, 'tests/scripts/fixtures/upload-server');
const PYTHON = path.join(ROOT, 'packages/python/.venv/bin/python');
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
  requireBuilt('packages', 'packages/ts/dist/index.js');
  requireBuilt('hyper-install-python', 'packages/python/.venv/bin/python');
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
  requireBuilt('packages', 'packages/ts/dist/index.js');
  requireBuilt('hyper-install-python', 'packages/python/.venv/bin/python');
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

// The host layer of the three servers over HTTP (HY-45, HY-52, HY-59, HY-60, HY-67, HY-97, HY-99, HY-100, HY-129): the
// hooks of a start append one line for each call to a log file of the server, and a scenario compares the response of
// an exchange and the lines that the exchange added. No scenario waits for a time: it waits for the end of a response,
// for the line with which a server reports the end of a request, or for the connection of a handler to the gate.

type Name = (typeof SERVERS)[number];

/** A response as the client read it: `none` when the server closed the connection without a byte. */
interface Answer { none: boolean; status: number; lines: [string, string][]; body: string; port: number }

/** The output lines of a server process, kept from the start of the reader on. */
interface Lines { kept: string[]; until: (from: number, matches: (line: string) => boolean, what: string) => Promise<void> }

/** A started server of a scenario: its address, its output lines, its directory and the number of log lines read. */
interface Host { name: Name; url: string; lines: Lines; directory: string; read: number }

/** The gate of a run: `next` resolves with the connection of the handler that stopped at `point`. */
interface Gate { port: number; next: (point: string) => Promise<Socket> }

/** What a response must be. A header of `headers` must be exactly one line with the value. */
interface Wanted {
  status: number;
  body?: string;
  bodyContains?: string;
  bodyLongerThan?: number;
  headers?: Record<string, string>;
  absent?: string[];
  cookie?: RegExp;
}

/** The start of a scenario: the variables of the fixture servers and the settings of PHP that it adds. */
interface Start { env?: Record<string, string>; ini?: string[]; servers?: readonly Name[]; gate?: boolean; files?: boolean }

const FILLER = 6 * 1024 * 1024;
const FORM = 'application/x-www-form-urlencoded';
const SESSION = { php: '[A-Za-z0-9,-]{22,128}', node: '[0-9a-f]{64}', python: '[0-9a-f]{64}' };
const PLAIN_500: Wanted = { status: 500, body: 'Internal Server Error', headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "frame-ancestors 'self'" }, absent: ['set-cookie'] };
const NOTED = '{"stage":"shared"}';

const show = (value: unknown): string => (value instanceof RegExp ? String(value) : JSON.stringify(value));
const responseLine = (status: number, request: string, mark = '-', failure = 'null', notes = NOTED): string => `response ${status} ${request} mark=${mark} elapsed=ok failure=${failure} notes=${notes}`;
const writtenLine = (status: number | null, ended: boolean, request: string, failure = 'null'): string => `written ${status} ${ended} ${request} mark=- elapsed=ok failure=${failure}`;
const disconnectLine = (request: string, mark = '-'): string => `disconnect ${request} mark=${mark} elapsed=ok notes=${NOTED}`;

// The bytes of a request with `Connection: close` and, for a body or a POST, its Content-Length.
function requestBytes(method: string, target: string, headers: Record<string, string> = {}, body = ''): Buffer {
  const lines = [`${method} ${target} HTTP/1.1`, 'Host: x', 'Connection: close', ...(body !== '' || method === 'POST' ? [`Content-Length: ${Buffer.byteLength(body)}`] : []), ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`)];
  return Buffer.from(`${lines.join('\r\n')}\r\n\r\n${body}`);
}

// Writes the bytes of one request and resolves with the response when the connection has closed: every header line in
// its order, so that the lines of one name can be counted, and the local port, by which a server names the request.
function exchange(url: string, bytes: Buffer): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const { hostname, port } = new URL(url);
    const socket = connect(Number(port), hostname);
    const chunks: Buffer[] = [];
    let local = 0;
    socket.on('connect', () => {
      local = socket.localPort ?? 0;
      socket.write(bytes);
    });
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    // A server that closes a connection whose request it did not read to its end may reset it; what was read counts.
    socket.on('error', () => undefined);
    socket.on('close', () => {
      const response = Buffer.concat(chunks).toString('latin1');
      if (response === '') {
        resolve({ none: true, status: 0, lines: [], body: '', port: local });
        return;
      }
      const head = response.indexOf('\r\n\r\n');
      const status = /^HTTP\/1\.[01] (\d{3})/.exec(response);
      if (head < 0 || status === null) {
        reject(new Error(`the server answered bytes that are no response: ${JSON.stringify(response.slice(0, 200))}`));
        return;
      }
      const lines = response.slice(0, head).split('\r\n').slice(1).map((line): [string, string] => [line.slice(0, line.indexOf(':')).toLowerCase(), line.slice(line.indexOf(':') + 1).trim()]);
      resolve({ none: false, status: Number(status[1]), lines, body: Buffer.from(response.slice(head + 4), 'latin1').toString('utf8'), port: local });
    });
  });
}

// The JSON value of a body, or the text of a body that is no JSON, and a member of a value that is an object.
function jsonOf(body: string): unknown {
  try {
    const value: unknown = JSON.parse(body);
    return value;
  } catch (error) {
    if (error instanceof SyntaxError) return body;
    throw error;
  }
}
function member(value: unknown, name: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  const found: unknown = Reflect.get(value, name);
  return found;
}

const valuesOf = (answer: Answer, name: string): string[] => answer.lines.filter(([header]) => header === name).map(([, value]) => value);

// Keeps every output line of a server from now on. `until` resolves when a line from the index `from` on matches,
// also when it arrived before the call, and rejects when the server exited without one.
function linesOf(t: TestContext, child: ChildProcess): Lines {
  const kept: string[] = [];
  let waiting: (() => void)[] = [];
  let exited = false;
  const wake = (): void => {
    const woken = waiting;
    waiting = [];
    for (const resolve of woken) resolve();
  };
  for (const stream of [child.stdout, child.stderr]) {
    let pending = '';
    stream?.on('data', (data: Buffer) => {
      const lines = (pending + data.toString()).split('\n');
      pending = lines.pop() ?? '';
      kept.push(...lines);
      wake();
    });
  }
  child.once('exit', () => {
    exited = true;
    wake();
  });
  const until = async (from: number, matches: (line: string) => boolean, what: string): Promise<void> => {
    // The time limit of the test names the step that it waited for.
    const named = (): void => { process.stdout.write(`the test ended while it waited for ${what}\n`); };
    t.signal.addEventListener('abort', named);
    try {
      while (!kept.slice(from).some(matches)) {
        if (exited) throw new Error(`the server exited before ${what}; its last lines: ${show(kept.slice(-5))}`);
        await new Promise<void>((resolve) => waiting.push(resolve));
      }
    } finally {
      t.signal.removeEventListener('abort', named);
    }
  };
  return { kept, until };
}

// Resolves when the server reported the end of the request of the client port, after which every hook of the request
// has returned: the PHP built-in server writes `Closing` after the shutdown functions, and the Node and Python fixture
// servers print `ended`.
function ended(host: Host, port: number, from: number): Promise<void> {
  const matches = host.name === 'php' ? (line: string): boolean => line.endsWith(`127.0.0.1:${port} Closing`) : (line: string): boolean => line === `ended ${port}`;
  return host.lines.until(from, matches, `the line of ${host.name} that ends the request of the client port ${port}`);
}

// One exchange that the client reads to its end, and the end of its request in the server.
async function ask(host: Host, bytes: Buffer, reported = true): Promise<Answer> {
  const from = host.lines.kept.length;
  const answer = await exchange(host.url, bytes);
  if (reported) await ended(host, answer.port, from);
  return answer;
}

// One exchange whose client resets the connection while a handler waits at the gate (HY-67): the handler continues
// only after the close of the client socket, so its server writes to a closed connection.
async function leave(host: Host, gate: Gate, point: string, bytes: Buffer): Promise<void> {
  const from = host.lines.kept.length;
  const { hostname, port } = new URL(host.url);
  const client = connect(Number(port), hostname);
  client.on('error', () => undefined);
  await new Promise<void>((resolve) => client.once('connect', () => resolve()));
  const local = client.localPort ?? 0;
  client.write(bytes);
  const passage = await gate.next(point);
  const closed = new Promise<void>((resolve) => client.once('close', () => resolve()));
  client.resetAndDestroy();
  await closed;
  passage.end('open\n');
  await ended(host, local, from);
}

// The lines of the kinds that the server added to its hook log since the last call.
function logged(host: Host, kinds: string[]): string[] {
  const file = path.join(host.directory, 'hooks.log');
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').slice(0, -1) : [];
  const added = lines.slice(host.read);
  host.read = lines.length;
  return added.filter((line) => kinds.includes(line.slice(0, line.indexOf(' '))));
}

// The lines of the log of the application; PHP error_log writes `[<time>] ` before each, which is not part of the text.
function errorLines(host: Host): string[] {
  const file = path.join(host.directory, 'errors.log');
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : [];
  return host.name === 'php' ? lines.map((line) => line.replace(/^\[[^\]]*\] /, '')) : lines;
}

const sessionsOf = (host: Host): string[] => readdirSync(path.join(host.directory, 'sessions')).sort();

// The checks of one server in a scenario: every difference is kept, and `end` fails with all of them, each with what
// was expected and what was observed.
function checks(host: Host): {
  same: (what: string, observed: unknown, expected: unknown) => void;
  response: (what: string, answer: Answer, wanted: Wanted) => string | null;
  log: (what: string, kinds: string[], expected: (string | RegExp)[]) => void;
  errors: (what: string, message: string) => void;
  end: () => void;
} {
  const problems: string[] = [];
  const differs = (what: string, expected: unknown, observed: unknown): void => { problems.push(`${host.name}, ${what}: expected ${show(expected)}, observed ${show(observed)}`); };
  const same = (what: string, observed: unknown, expected: unknown): void => {
    if (!isDeepStrictEqual(observed, expected)) differs(what, expected, observed);
  };
  return {
    same,
    // Returns the identifier of the session cookie that `wanted.cookie` matched, else null.
    response: (what, answer, wanted) => {
      if (answer.none) {
        differs(`${what}, the response`, wanted.status, 'no response: the server closed the connection');
        return null;
      }
      same(`${what}, the status`, answer.status, wanted.status);
      if (wanted.body !== undefined) same(`${what}, the body`, answer.body.length > 300 ? `${answer.body.slice(0, 300)}… (${answer.body.length} characters)` : answer.body, wanted.body);
      if (wanted.bodyContains !== undefined && !answer.body.includes(wanted.bodyContains)) differs(`${what}, the body`, `a body that contains ${wanted.bodyContains}`, answer.body.slice(0, 300));
      if (wanted.bodyLongerThan !== undefined && Buffer.byteLength(answer.body) <= wanted.bodyLongerThan) differs(`${what}, the size of the body`, `more than ${wanted.bodyLongerThan} bytes`, Buffer.byteLength(answer.body));
      for (const [name, value] of Object.entries(wanted.headers ?? {})) same(`${what}, the lines of the header ${name}`, valuesOf(answer, name), [value]);
      for (const name of wanted.absent ?? []) same(`${what}, the lines of the header ${name}`, valuesOf(answer, name), []);
      if (wanted.cookie === undefined) return null;
      const cookies = valuesOf(answer, 'set-cookie');
      const match = cookies.length === 1 ? wanted.cookie.exec(cookies[0] ?? '') : null;
      if (match === null) differs(`${what}, the Set-Cookie lines`, `one line that matches ${String(wanted.cookie)}`, cookies);
      return match?.[1] ?? null;
    },
    log: (what, kinds, expected) => {
      const lines = logged(host, kinds);
      const equal = lines.length === expected.length && expected.every((line, index) => (typeof line === 'string' ? line === lines[index] : line.test(lines[index] ?? '')));
      if (!equal) differs(`${what}, the lines of the hook log of the kinds ${kinds.join(', ')}`, expected.map((line) => (typeof line === 'string' ? line : String(line))), lines);
    },
    errors: (what, message) => {
      const lines = errorLines(host);
      if (!lines.some((line) => line.startsWith('hyper: ') && line.includes(message))) differs(`${what}, the log of the application`, `a line that starts with "hyper: " and contains ${message}`, lines.slice(0, 5));
    },
    end: () => {
      assert.equal(problems.length, 0, problems.join('\n'));
    },
  };
}

// Starts the servers of a scenario, each with its hook log, its error log and directories of its own, and the gate
// when the scenario stops a handler. The end of the test stops the servers, then closes the gate and removes the
// directory (HR-87).
async function hostsOf(t: TestContext, start: Start = {}): Promise<{ hosts: Host[]; gate: Gate }> {
  requireBuilt('packages', 'packages/ts/dist/index.js');
  requireBuilt('hyper-install-python', 'packages/python/.venv/bin/python');
  requireBuilt('hyper-install-php', 'vendor/autoload.php');
  // The gate: a handler connects, writes `gate <point>` and waits for `open`.
  const arrived: { point: string; socket: Socket }[] = [];
  let arrival: (() => void) | null = null;
  const sockets: Socket[] = [];
  const listener: Server = createServer((socket) => {
    sockets.push(socket);
    socket.on('error', () => undefined);
    let text = '';
    const read = (chunk: Buffer): void => {
      text += chunk.toString();
      if (!text.includes('\n')) return;
      socket.removeListener('data', read);
      arrived.push({ point: text.slice(0, text.indexOf('\n')), socket });
      arrival?.();
    };
    socket.on('data', read);
  });
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', () => resolve()));
  const address = listener.address();
  if (address === null || typeof address === 'string') throw new Error(`the gate listens on no TCP port: ${String(address)}`);
  const gate: Gate = {
    port: address.port,
    next: async (point) => {
      while (arrived.length === 0) await new Promise<void>((resolve) => { arrival = resolve; });
      const [first] = arrived.splice(0, 1);
      assert.equal(first?.point, `gate ${point}`, 'the line of the handler at the gate');
      if (first === undefined) throw new Error('no handler is at the gate');
      return first.socket;
    },
  };
  const { directory, children, environment } = await started(t);
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  });
  const hosts: Host[] = [];
  for (const name of start.servers ?? SERVERS) {
    const own = path.join(directory, name);
    const env: Record<string, string> = {
      ...environment(name),
      UPLOAD_LOG: path.join(own, 'hooks.log'),
      UPLOAD_ERRORS: path.join(own, 'errors.log'),
      ...(start.gate === true ? { UPLOAD_GATE: String(gate.port) } : {}),
      ...(start.files === true ? { UPLOAD_FILES: path.join(own, 'public') } : {}),
      ...start.env,
    };
    if (start.files === true) {
      mkdirSync(path.join(own, 'public/sub'), { recursive: true });
      writeFileSync(path.join(own, 'public/data.json'), '{"a":1}\n');
      writeFileSync(path.join(own, 'public/sub/inner.txt'), 'inner\n');
      writeFileSync(path.join(own, 'outside.json'), '{"outside":true}\n');
    }
    // The settings of PHP that the answers depend on are given here, so that no php.ini of the machine decides them.
    const server = name === 'php'
      ? await startPhp({ name, app: FIXTURE, port: 0, env, ini: ['enable_post_data_reading=0', 'post_max_size=64M', `session.save_path=${path.join(own, 'sessions')}`, 'output_buffering=0', ...(start.ini ?? [])], children })
      : await startServer({ name, command: name === 'node' ? process.execPath : PYTHON, args: name === 'node' ? ['--no-warnings', path.join(FIXTURE, 'server.mjs')] : [path.join(FIXTURE, 'server.py')], env: { ...process.env, ...env }, ready: READY, children });
    hosts.push({ name, url: server.url, lines: linesOf(t, server.child), directory: own, read: 0 });
  }
  return { hosts, gate };
}

// Runs the checks of a scenario for each of its servers as a test of its own, so that a server that fails does not
// hide the result of another, and fails a scenario that checked no server (HR-84).
async function eachHost(t: TestContext, hosts: Host[], run: (host: Host, check: ReturnType<typeof checks>) => Promise<void>): Promise<void> {
  let ran = 0;
  for (const host of hosts) {
    await t.test(host.name, async () => {
      const check = checks(host);
      await run(host, check);
      ran += 1;
      check.end();
    });
  }
  assert.ok(ran > 0, 'the scenario ran no exchange');
}

const HOOKS = ['load', 'response', 'written', 'disconnect'];
const ALL = ['around', ...HOOKS];
const SCENARIO = { timeout: 120_000 };

test('write-hook-reports-a-complete-response (HY-99.2, HY-99.3, HY-99.8, HY-60.2, HY-60.8, HY-67.2, HY-67.11)', SCENARIO, async (t) => {
  const { hosts } = await hostsOf(t, { env: { UPLOAD_ANSWER: 'none' } });
  await eachHost(t, hosts, async (host, check) => {
    check.response('GET /', await ask(host, requestBytes('GET', '/')), { status: 200, bodyContains: '<p>upload</p>' });
    check.log('GET /', HOOKS, ['load shared mark=-', 'load home mark=-', responseLine(200, 'GET /'), writtenLine(200, true, 'GET /')]);
    check.response('GET /large', await ask(host, requestBytes('GET', '/large')), { status: 200, bodyLongerThan: FILLER });
    check.log('GET /large', HOOKS, ['load shared mark=-', 'load large mark=-', responseLine(200, 'GET /large'), writtenLine(200, true, 'GET /large')]);
  });
});

test('response-hook-error-is-the-plain-500 (HY-60.13 to HY-60.17, HY-99.2, HY-99.5, HY-43.4)', SCENARIO, async (t) => {
  const { hosts } = await hostsOf(t, { env: { UPLOAD_ANSWER: 'none', UPLOAD_HOOK: 'throws' } });
  await eachHost(t, hosts, async (host, check) => {
    check.response('GET /list', await ask(host, requestBytes('GET', '/list')), PLAIN_500);
    // The response hook receives the response of the application once; the plain 500 is not reported to it (HY-60.16).
    check.log('GET /list', ['response', 'written', 'disconnect'], [responseLine(200, 'GET /list'), writtenLine(500, true, 'GET /list', '"hook boom"')]);
    check.errors('GET /list', 'hook boom');
  });
});

test('handler-error-is-the-plain-500-and-is-reported (HY-43.1, HY-43.2, HY-43.4, HY-43.5, HY-60.2, HY-60.8, HY-60.11, HY-65.1, HY-99.2)', SCENARIO, async (t) => {
  const { hosts } = await hostsOf(t, { env: { UPLOAD_ANSWER: 'none', UPLOAD_LOAD: 'throws' } });
  await eachHost(t, hosts, async (host, check) => {
    // The error is handled (HY-43): the response hook receives the 500 with the message and the notes of the reply, and
    // the write hook receives no failure, which is the message of an escaped error only (HY-99.2).
    check.response('GET /', await ask(host, requestBytes('GET', '/')), { ...PLAIN_500, absent: [], cookie: new RegExp(`^hy-session=(${SESSION[host.name]}); path=/; HttpOnly; SameSite=Lax$`) });
    check.log('GET /', HOOKS, ['load shared mark=-', 'load home mark=-', responseLine(500, 'GET /', '-', '"handler boom"'), writtenLine(500, true, 'GET /')]);
    check.errors('GET /', 'handler boom');
  });
});

test('session-open-error-is-the-plain-500 (HY-60.14 to HY-60.17, HY-99.2, HY-99.5, HY-100.2)', SCENARIO, async (t) => {
  // The session store of each server fails to open: the store of App.server in Node, the store of create_server in
  // Python and the session save handler of PHP, which `App::run` starts.
  const { hosts } = await hostsOf(t, { env: { UPLOAD_ANSWER: 'none', UPLOAD_SESSIONS_OPEN: 'throws' } });
  await eachHost(t, hosts, async (host, check) => {
    check.response('GET /', await ask(host, requestBytes('GET', '/')), PLAIN_500);
    // The error escapes before a handler runs: no loader runs, the response hook receives no response, and the write
    // hook receives the plain 500 once with the failure (HY-60.16, HY-60.17, HY-99.5).
    check.log('GET /', HOOKS, [writtenLine(500, true, 'GET /', '"the session directory is gone"')]);
    check.errors('GET /', 'the session directory is gone');
  });
});

test('escaped-500-keeps-the-headers-of-the-caller (HY-60.24 to HY-60.27, HY-99.2)', SCENARIO, async (t) => {
  // The `http.server` server of Python has no caller before hyper, so it is not run.
  const { hosts } = await hostsOf(t, { env: { UPLOAD_ANSWER: 'none', UPLOAD_HOOK: 'throws', UPLOAD_BEFORE: '1' }, servers: ['php', 'node'] });
  await eachHost(t, hosts, async (host, check) => {
    // One Content-Type line: the type of the replaced response is gone (HY-60.25).
    check.response('GET /list', await ask(host, requestBytes('GET', '/list')), { ...PLAIN_500, headers: { ...PLAIN_500.headers, 'x-before': 'kept' } });
    check.log('GET /list', ['response', 'written', 'disconnect'], [responseLine(200, 'GET /list'), writtenLine(500, true, 'GET /list', '"hook boom"')]);
  });
});

test('around-answers-a-changed-copy-and-changes-the-response (HY-97.2, HY-97.3, HY-97.4, HY-45.1, HY-45.3, HY-99.2, HY-104.9)', SCENARIO, async (t) => {
  const { hosts } = await hostsOf(t, { env: { UPLOAD_ANSWER: 'mark' } });
  await eachHost(t, hosts, async (host, check) => {
    const identifier = check.response('GET /', await ask(host, requestBytes('GET', '/')), { status: 200, bodyContains: '<p>upload</p>', headers: { 'x-around': 'yes' }, cookie: new RegExp(`^hy-session=(${SESSION[host.name]}); path=/; HttpOnly; SameSite=Lax$`) });
    check.same('GET /, the entries of the session directory', sessionsOf(host), [`sess_${identifier}`]);
    // The handlers and the response hook read the header of the copy; the write hook receives the request that the
    // server gave to around (HY-99.2).
    check.log('GET /', ALL, ['around GET / mark=-', 'load shared mark=changed', 'load home mark=changed', responseLine(200, 'GET /', 'changed'), writtenLine(200, true, 'GET /')]);
  });
});

test('around-answers-a-copy-with-another-accept (HY-97.3, HY-97.4)', SCENARIO, async (t) => {
  const { hosts } = await hostsOf(t, { env: { UPLOAD_ANSWER: 'accept' } });
  await eachHost(t, hosts, async (host, check) => {
    const answer = await ask(host, requestBytes('GET', '/items/7'));
    check.response('GET /items/7', answer, { status: 200, headers: { 'content-type': 'application/vnd.hyper+json' } });
    const page = jsonOf(answer.body);
    check.same('GET /items/7, the members route and params of the body', { route: member(page, 'route'), params: member(page, 'params') }, { route: 'item', params: { id: '7' } });
    check.log('GET /items/7', ['around', 'response', 'written', 'disconnect'], ['around GET /items/7 mark=-', responseLine(200, 'GET /items/7'), writtenLine(200, true, 'GET /items/7')]);
  });
});

test('around-alone-answers-without-the-application (HY-97.4, HY-99.2, HY-45.4)', SCENARIO, async (t) => {
  const { hosts } = await hostsOf(t, { env: { UPLOAD_ANSWER: 'alone' } });
  await eachHost(t, hosts, async (host, check) => {
    check.response('GET /', await ask(host, requestBytes('GET', '/')), { status: 418, body: 'alone', headers: { 'content-type': 'text/plain; charset=utf-8' }, absent: ['set-cookie'] });
    check.same('GET /, the entries of the session directory', sessionsOf(host), []);
    // No loader, action or hook of the application runs.
    check.log('GET /', ALL, ['around GET / mark=-', writtenLine(418, true, 'GET /')]);
  });
});

test('around-error-is-the-plain-500 (HY-97.8, HY-60.14, HY-60.15, HY-60.16, HY-99.2)', SCENARIO, async (t) => {
  const { hosts } = await hostsOf(t, { env: { UPLOAD_ANSWER: 'throws' } });
  await eachHost(t, hosts, async (host, check) => {
    check.response('GET /', await ask(host, requestBytes('GET', '/')), PLAIN_500);
    check.same('GET /, the entries of the session directory', sessionsOf(host), []);
    check.log('GET /', ALL, ['around GET / mark=-', writtenLine(500, true, 'GET /', '"around boom"')]);
    check.errors('GET /', 'around boom');
  });
});

test('around-return-value-that-is-no-response-is-the-plain-500 (HY-97.8, HY-60.14, HY-60.15, HY-99.2)', SCENARIO, async (t) => {
  const { hosts } = await hostsOf(t, { env: { UPLOAD_ANSWER: 'not-a-response' } });
  await eachHost(t, hosts, async (host, check) => {
    check.response('GET /', await ask(host, requestBytes('GET', '/')), PLAIN_500);
    // The failure is compared by the part that the three runtimes share; the rest is the form of the runtime.
    check.log('GET /', ALL, ['around GET / mark=-', /^written 500 true GET \/ mark=- elapsed=ok failure="[^"]*not a Response[^"]*"$/]);
    check.errors('GET /', 'not a Response');
  });
});

test('client-closes-the-connection-during-the-answer (HY-67.2 to HY-67.9, HY-99.2, HY-99.3, HY-99.6, HY-99.11, HY-60.8, HY-100.30)', SCENARIO, async (t) => {
  // PHP starts with ignore_user_abort on, so its lines after `response` exist only when App::run turned it off.
  const { hosts, gate } = await hostsOf(t, { env: { UPLOAD_ANSWER: 'none', UPLOAD_GATE_AT: 'shared' }, gate: true, ini: ['ignore_user_abort=1'] });
  // PHP and Python render the complete response, whose write fails; Node learns of the close while the shared handler
  // runs, runs no further loader and gives the write hook no response.
  const rendered = ['load shared mark=-', 'load large mark=-', responseLine(200, 'GET /large'), writtenLine(200, false, 'GET /large'), disconnectLine('GET /large')];
  const expected = { php: rendered, node: ['load shared mark=-', writtenLine(null, false, 'GET /large'), disconnectLine('GET /large')], python: rendered };
  await eachHost(t, hosts, async (host, check) => {
    await leave(host, gate, 'shared', requestBytes('GET', '/large'));
    check.log('GET /large', HOOKS, expected[host.name]);
  });
});

test('client-closes-the-connection-during-the-answer-of-around (HY-97.5, HY-67.2, HY-67.3, HY-67.4, HY-67.9, HY-99.2, HY-99.3, HY-99.11)', SCENARIO, async (t) => {
  const { hosts, gate } = await hostsOf(t, { env: { UPLOAD_ANSWER: 'mark', UPLOAD_GATE_AT: 'shared' }, gate: true });
  // The write hook receives the request that the server gave to around; the disconnect hook receives the request and
  // the reply of the last call of answer (HY-97.5).
  const rendered = ['around GET /large mark=-', 'load shared mark=changed', 'load large mark=changed', responseLine(200, 'GET /large', 'changed'), writtenLine(200, false, 'GET /large'), disconnectLine('GET /large', 'changed')];
  const expected = { php: rendered, node: ['around GET /large mark=-', 'load shared mark=changed', writtenLine(null, false, 'GET /large'), disconnectLine('GET /large', 'changed')], python: rendered };
  await eachHost(t, hosts, async (host, check) => {
    await leave(host, gate, 'shared', requestBytes('GET', '/large'));
    check.log('GET /large', ALL, expected[host.name]);
  });
});

test('client-closes-the-connection-before-the-response-of-around-alone (HY-97.4, HY-97.5, HY-99.2, HY-99.3, HY-67.2)', SCENARIO, async (t) => {
  const { hosts, gate } = await hostsOf(t, { env: { UPLOAD_ANSWER: 'alone-gate' }, gate: true });
  await eachHost(t, hosts, async (host, check) => {
    await leave(host, gate, 'around', requestBytes('GET', '/'));
    // around never called answer: no response hook and no disconnect hook; the write hook receives its response.
    check.log('GET /', ALL, ['around GET / mark=-', writtenLine(200, false, 'GET /')]);
    check.same('GET /, the entries of the session directory', sessionsOf(host), []);
  });
});

// The token of a masked CSRF value: its second half XOR its first half (HY-24.2).
function unmasked(masked: string): string {
  const bytes = Buffer.from(masked, 'hex');
  const half = bytes.length / 2;
  return Buffer.from(bytes.subarray(half).map((byte, index) => byte ^ (bytes[index] ?? 0))).toString('hex');
}

test('session-cookie-of-a-new-session (HY-45.1, HY-45.3, HY-45.4, HY-24.2, HY-24.3, HY-97.3, HY-104.2, HY-104.9, HY-52.7)', SCENARIO, async (t) => {
  const { hosts } = await hostsOf(t, { env: { UPLOAD_ANSWER: 'none' } });
  const csrfOf = (answer: Answer): string => {
    const csrf = member(member(jsonOf(answer.body), 'shared'), 'csrf');
    return typeof csrf === 'string' ? csrf : '';
  };
  await eachHost(t, hosts, async (host, check) => {
    const accept = { Accept: 'application/vnd.hyper+json' };
    const first = await ask(host, requestBytes('GET', '/list', accept));
    const identifier = check.response('the first GET /list', first, { status: 200, cookie: new RegExp(`^hy-session=(${SESSION[host.name]}); path=/; HttpOnly; SameSite=Lax$`) });
    check.same('the first GET /list, whether shared.csrf has 128 hexadecimal digits', /^[0-9a-f]{128}$/.test(csrfOf(first)), true);
    check.same('the first GET /list, the entries of the session directory', sessionsOf(host), [`sess_${identifier}`]);
    const second = await ask(host, requestBytes('GET', '/list', { ...accept, Cookie: `hy-session=${identifier}` }));
    check.response('the second GET /list', second, { status: 200, absent: ['set-cookie'] });
    check.same('the second GET /list, whether shared.csrf has 128 hexadecimal digits', /^[0-9a-f]{128}$/.test(csrfOf(second)), true);
    check.same('the second GET /list, whether shared.csrf differs from the first value', csrfOf(second) !== csrfOf(first), true);
    check.same('the second GET /list, the token that shared.csrf masks', unmasked(csrfOf(second)), unmasked(csrfOf(first)));
    check.same('the second GET /list, the entries of the session directory', sessionsOf(host), [`sess_${identifier}`]);
  });
});

test('no-session-for-a-path-without-a-route (HY-45.4, HY-27.1, HY-60.2, HY-60.8, HY-65.1)', SCENARIO, async (t) => {
  const { hosts } = await hostsOf(t, { env: { UPLOAD_ANSWER: 'none' } });
  await eachHost(t, hosts, async (host, check) => {
    const before = sessionsOf(host);
    check.response('GET /missing', await ask(host, requestBytes('GET', '/missing')), { status: 404, body: 'Not Found', headers: { 'cache-control': 'no-store' }, absent: ['set-cookie'] });
    check.log('GET /missing', HOOKS, [responseLine(404, 'GET /missing', '-', 'null', '{}'), writtenLine(404, true, 'GET /missing')]);
    check.same('GET /missing, the entries of the session directory', sessionsOf(host), before);
  });
});

test('session-cookie-is-secure-when-the-application-declares-https (HY-45.1, HY-45.3, HY-45.6)', SCENARIO, async (t) => {
  const { hosts } = await hostsOf(t, { env: { UPLOAD_ANSWER: 'none', UPLOAD_HTTPS: '1' } });
  await eachHost(t, hosts, async (host, check) => {
    check.response('GET /', await ask(host, requestBytes('GET', '/')), { status: 200, cookie: new RegExp(`^__Host-hy-session=(${SESSION[host.name]}); path=/; secure; HttpOnly; SameSite=Lax$`) });
  });
});

const TOO_LARGE: Wanted = { status: 413, body: 'Content Too Large', headers: { 'cache-control': 'no-store', 'content-security-policy': "frame-ancestors 'self'" }, absent: ['set-cookie'] };

test('body-over-the-limit-is-413 (HY-59.4, HY-59.5, HY-59.6, HY-60.2, HY-60.8, HY-45.4, HY-65.1)', SCENARIO, async (t) => {
  const { hosts } = await hostsOf(t, { env: { UPLOAD_ANSWER: 'none', UPLOAD_LIMIT: '10' } });
  await eachHost(t, hosts, async (host, check) => {
    check.response('POST /add', await ask(host, requestBytes('POST', '/add', { 'Content-Type': FORM }, 'name=aaaaaaaaaaaaaaaaaaaa')), TOO_LARGE);
    check.log('POST /add', HOOKS, [responseLine(413, 'POST /add', '-', 'null', '{}'), writtenLine(413, true, 'POST /add')]);
    check.same('POST /add, the entries of the session directory', sessionsOf(host), []);
  });
});

test('chunked-body-is-read-and-the-body-limit-applies, a body over the limit (HY-59.4, HY-59.5, HY-59.6, HY-100.2, HY-60.2, HY-45.4, HY-65.1)', SCENARIO, async (t) => {
  const { hosts } = await hostsOf(t, { env: { UPLOAD_ANSWER: 'none', UPLOAD_LIMIT: '10' } });
  await eachHost(t, hosts, async (host, check) => {
    // 16 bytes in two chunks, without a Content-Length.
    const bytes = Buffer.from('POST /add HTTP/1.1\r\nHost: x\r\nConnection: close\r\nTransfer-Encoding: chunked\r\nContent-Type: text/plain\r\n\r\n8\r\n12345678\r\n8\r\n12345678\r\n0\r\n\r\n');
    check.response('POST /add with a chunked body of 16 bytes', await ask(host, bytes), TOO_LARGE);
    check.log('POST /add with a chunked body of 16 bytes', HOOKS, [responseLine(413, 'POST /add', '-', 'null', '{}'), writtenLine(413, true, 'POST /add')]);
    check.same('POST /add with a chunked body of 16 bytes, the entries of the session directory', sessionsOf(host), []);
  });
});

test('chunked-body-is-read-and-the-body-limit-applies, a body under the limit (HY-59.4, HY-100.2)', SCENARIO, async (t) => {
  // The request hook of the fixture answers what the request gave of its body.
  const { hosts } = await hostsOf(t);
  await eachHost(t, hosts, async (host, check) => {
    const bytes = Buffer.from(`POST / HTTP/1.1\r\nHost: x\r\nConnection: close\r\nTransfer-Encoding: chunked\r\nContent-Type: ${FORM}\r\n\r\n3\r\na=1\r\n4\r\n&b=2\r\n0\r\n\r\n`);
    const answer = await ask(host, bytes);
    check.response('POST / with a chunked body of 7 bytes', answer, { status: 200 });
    check.same('POST / with a chunked body of 7 bytes, the body', jsonOf(answer.body), { valid: true, form: [['a', ['1']], ['b', ['2']]], files: [], held: 0 });
    check.log('POST / with a chunked body of 7 bytes', ALL, ['around POST / mark=-', writtenLine(200, true, 'POST /')]);
  });
});

test('no-content-type-without-a-body-and-one-cache-control (HY-52.5, HY-52.7, HY-52.8, HY-40.1, HY-25, HY-65)', SCENARIO, async (t) => {
  const { hosts } = await hostsOf(t, { env: { UPLOAD_ANSWER: 'none' } });
  await eachHost(t, hosts, async (host, check) => {
    const page = await ask(host, requestBytes('GET', '/list?embed=1'));
    // No host adds a caching header of its session (HY-52.7): one Cache-Control line.
    const identifier = check.response('GET /list?embed=1', page, { status: 200, headers: { 'cache-control': 'no-store' }, absent: ['expires', 'pragma'], cookie: /^hy-session=([^;]+);/ });
    const token = /"csrf":"([0-9a-f]{128})"/.exec(page.body)?.[1];
    check.same('GET /list?embed=1, whether the body embeds the CSRF value', token !== undefined, true);
    logged(host, []);
    const headers = { Cookie: `hy-session=${identifier}`, 'Content-Type': FORM };
    check.response('POST /_hyper/keep', await ask(host, requestBytes('POST', '/_hyper/keep', headers, `_csrf=${token}&region=rows&path=open&value=true`)), { status: 204, body: '', absent: ['content-type'] });
    check.log('POST /_hyper/keep', ['response', 'written', 'disconnect'], [/^response 204 POST \/_hyper\/keep mark=- elapsed=ok failure=null notes=\{.*\}$/, writtenLine(204, true, 'POST /_hyper/keep')]);
    check.response('POST /add', await ask(host, requestBytes('POST', '/add', headers, `_csrf=${token}&name=a`)), { status: 303, headers: { location: '/' }, absent: ['content-type'] });
    check.log('POST /add', ['response', 'written', 'disconnect'], [/^response 303 POST \/add mark=- elapsed=ok failure=null notes=\{.*\}$/, writtenLine(303, true, 'POST /add')]);
  });
});

test('public-files-are-served-before-around (HY-97.6, HY-60.12, HY-99.12, HY-100.4, HY-27.1)', SCENARIO, async (t) => {
  // PHP leaves public files to its web server, so it is not run.
  const { hosts } = await hostsOf(t, { env: { UPLOAD_ANSWER: 'app' }, files: true, servers: ['node', 'python'] });
  const missing = (request: string): string[] => [`around ${request} mark=-`, responseLine(404, request, '-', 'null', '{}'), writtenLine(404, true, request)];
  await eachHost(t, hosts, async (host, check) => {
    check.response('GET /data.json', await ask(host, requestBytes('GET', '/data.json')), { status: 200, body: '{"a":1}\n', headers: { 'content-type': 'application/json; charset=utf-8', 'content-length': '8' } });
    check.log('GET /data.json', ALL, []);
    check.response('GET /sub', await ask(host, requestBytes('GET', '/sub')), { status: 404, body: 'Not Found' });
    check.log('GET /sub', ALL, missing('GET /sub'));
    check.response('GET /../outside.json', await ask(host, Buffer.from('GET /../outside.json HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n')), { status: 404, body: 'Not Found' });
    check.log('GET /../outside.json', ALL, missing('GET /../outside.json'));
    check.response('POST /data.json', await ask(host, requestBytes('POST', '/data.json')), { status: 404, body: 'Not Found' });
    check.log('POST /data.json', ALL, missing('POST /data.json'));
  });
});

test('several-cookie-lines-are-one-cookie-header (HY-129.1, HY-129.4, HY-129.5, HY-129.6)', SCENARIO, async (t) => {
  const { hosts } = await hostsOf(t, { env: { UPLOAD_ANSWER: 'cookies' } });
  // The PHP built-in server joins the lines with `, ` before PHP reads them (HY-129.6).
  const expected = { php: '{"a":"1, b=2","b":null}', node: '{"a":"1","b":"2"}', python: '{"a":"1","b":"2"}' };
  await eachHost(t, hosts, async (host, check) => {
    check.response('GET / with two Cookie lines', await ask(host, Buffer.from('GET / HTTP/1.1\r\nHost: x\r\nCookie: a=1\r\nCookie: b=2\r\nConnection: close\r\n\r\n')), { status: 200, body: expected[host.name] });
  });
});

test('request-method-reaches-the-application-in-upper-case (HY-100.31, HY-27.2, HY-27.6, HY-60.2, HY-60.7, HY-99.2, HY-99.12, HY-65.1)', SCENARIO, async (t) => {
  const { hosts } = await hostsOf(t, { env: { UPLOAD_ANSWER: 'none' } });
  const KINDS = ['response', 'written', 'disconnect'];
  const refused = (method: string): { wanted: Wanted; log: string[] } => ({
    wanted: { status: 405, body: 'Method Not Allowed', headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' } },
    log: [responseLine(405, `${method} /`, '-', 'null', '{}'), writtenLine(405, true, `${method} /`)],
  });
  // node:http refuses a method in lower case with the 400 of HY-60.7, which the response hook receives with the request
  // of the request line; no listener runs, so no write hook is called and the end of the client socket ends the exchange.
  const bad = (method: string): { wanted: Wanted; log: string[]; reported: boolean } => ({
    wanted: { status: 400, body: 'Bad Request', headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "frame-ancestors 'self'" } },
    log: [responseLine(400, `${method} /`, '-', 'null', '{}')],
    reported: false,
  });
  // Each server passes every method that its transport accepts: the PHP built-in server answers a method outside its
  // list with its own 501 and gives no response to a method in lower case; `http.server` passes every method.
  const expected: Record<Name, Record<string, { wanted: Wanted | null; log: string[]; reported?: boolean }>> = {
    php: { TRACE: refused('TRACE'), PURGE: { wanted: { status: 501 }, log: [] }, purge: { wanted: null, log: [] }, get: { wanted: null, log: [] } },
    node: { TRACE: refused('TRACE'), PURGE: refused('PURGE'), purge: bad('PURGE'), get: bad('GET') },
    python: { TRACE: refused('TRACE'), PURGE: refused('PURGE'), purge: refused('PURGE'), get: { wanted: { status: 200, bodyContains: '<p>upload</p>' }, log: [responseLine(200, 'GET /'), writtenLine(200, true, 'GET /')] } },
  };
  await eachHost(t, hosts, async (host, check) => {
    for (const [method, { wanted, log, reported }] of Object.entries(expected[host.name])) {
      const answer = await ask(host, Buffer.from(`${method} / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`), reported ?? true);
      if (wanted === null) check.same(`${method} /, the response`, answer.none ? 'no response: the server closed the connection' : `${answer.status} ${answer.body.slice(0, 100)}`, 'no response: the server closed the connection');
      else check.response(`${method} /`, answer, wanted);
      check.log(`${method} /`, KINDS, log);
    }
  });
});
