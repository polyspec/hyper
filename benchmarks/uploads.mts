// Measures what an upload costs in the three servers and in the reader of PHP itself (HY-131): one real server of each
// reads the same request bodies, and the report gives the time of a request as its client sees it, the processor time
// of the server process and its largest memory. The servers are those of tests/scripts/fixtures/upload-server: the
// PHP application under PHP-FPM, which a FastCGI client of this file calls as a web server does, the server of
// `App.server` of Node and the `http.server` server of Python. The reader of PHP itself is benchmarks/uploads-native.php
// under PHP-FPM with `enable_post_data_reading` on. The results are a report and judge nothing.
// Usage: node benchmarks/uploads.mts --size <bytes of the large file> --runs <n> [--json].
import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { closeSync, createReadStream, existsSync, mkdirSync, mkdtempSync, openSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

import { startServer, stopServers } from '../scripts/board-servers.mts';
import { requireBuilt } from '../tests/scripts/requires.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'tests/scripts/fixtures/upload-server');
const BOUNDARY = 'BenchBoundary';
const TYPE = `multipart/form-data; boundary=${BOUNDARY}`;

const { values } = parseArgs({ options: { size: { type: 'string' }, runs: { type: 'string' }, json: { type: 'boolean', default: false } } });
const size = Number(values.size);
const runs = Number(values.runs);
if (!Number.isInteger(size) || size < 1) throw new Error('--size must name a positive number of bytes');
if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must name a positive number');

requireBuilt('packages', 'packages/server/ts/dist/index.js');
requireBuilt('hyper-install-python', 'packages/server/python/.venv/bin/python');
requireBuilt('hyper-install-php', 'vendor/autoload.php');

interface Answer { valid: boolean; files: unknown; form: unknown; held: number; cpu: number; rss: number }
type Call = (body: string) => Promise<Answer>;

const directory = mkdtempSync(path.join(tmpdir(), 'hyper-bench-uploads-'));
const children: ChildProcess[] = [];
const log = (line: string): void => {
  if (!values.json) process.stdout.write(`${line}\n`);
};

// Writes a part of a file of `bytes` bytes to the open file, one block of 1 MiB after another.
function filePart(target: number, name: string, bytes: number): void {
  writeSync(target, `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"; filename="${name}.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`);
  const block = Buffer.alloc(1 << 20, 0x61);
  for (let left = bytes; left > 0; left -= block.length) writeSync(target, block.subarray(0, Math.min(left, block.length)));
  writeSync(target, '\r\n');
}

// Writes the bodies of the measurement and returns their paths by their labels.
function bodies(): [string, string][] {
  const written: [string, string][] = [];
  const write = (label: string, fill: (target: number) => void): void => {
    const file = path.join(directory, `body-${written.length}`);
    const target = openSync(file, 'w');
    try {
      fill(target);
      writeSync(target, `--${BOUNDARY}--\r\n`);
    } finally {
      closeSync(target);
    }
    written.push([label, file]);
  };
  const text = (name: string, value: string): string => `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  write(`one file of ${size} bytes`, (target) => filePart(target, 'f', size));
  write('500 values and 500 files of 204800 bytes', (target) => {
    for (let index = 0; index < 500; index += 1) {
      writeSync(target, text(`v${index}`, 'x'.repeat(100)));
      filePart(target, `f${index}`, 204_800);
    }
  });
  write('900 values of repeated and bracketed names', (target) => {
    for (let index = 0; index < 300; index += 1) writeSync(target, text(`user[address][${index % 7}]`, `거리 ${index}`) + text('tags[]', `tag-${index}`) + text('a.b c', 'x=1&y=2'));
  });
  return written;
}

// The environment of a server: its directories below the directory of the run.
function environment(name: string): Record<string, string> {
  for (const part of ['tmp', 'moved', 'sessions']) mkdirSync(path.join(directory, name, part), { recursive: true });
  return {
    UPLOAD_APP: path.join(directory, 'applications/upload'),
    UPLOAD_MOVED: path.join(directory, name, 'moved'),
    UPLOAD_SESSIONS: path.join(directory, name, 'sessions'),
    UPLOAD_LIMIT: String(size + (1 << 30)),
    UPLOAD_PARTS: '5000',
    UPLOAD_USAGE: '1',
    TMPDIR: path.join(directory, name, 'tmp'),
  };
}

// The largest memory in bytes: PHP and Python give kilobytes on Linux and bytes on Darwin.
const bytesOf = (rss: number): number => (process.platform === 'linux' ? rss * 1024 : rss);

// Sends a body over HTTP and resolves with the answer of the server.
function overHttp(url: string): Call {
  return (body) =>
    new Promise((resolve, reject) => {
      const sent = httpRequest(url, { method: 'POST', headers: { 'Content-Type': TYPE, 'Content-Length': statSync(body).size } }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          try {
            resolve(answerOf(Buffer.concat(chunks).toString('utf8')));
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      });
      sent.on('error', reject);
      createReadStream(body).pipe(sent);
    });
}

// Returns the answer of a server from its JSON text.
function answerOf(text: string): Answer {
  const value: unknown = JSON.parse(text);
  if (typeof value !== 'object' || value === null || !('cpu' in value) || typeof value.cpu !== 'number' || !('rss' in value) || typeof value.rss !== 'number' || !('valid' in value) || !('files' in value) || !('form' in value) || !('held' in value) || typeof value.held !== 'number') {
    throw new Error(`the server answered ${text.slice(0, 200)}`);
  }
  return { valid: value.valid === true, files: value.files, form: value.form, held: value.held, cpu: value.cpu, rss: value.rss };
}

// A FastCGI record: the version 1, the type, the request 1 and the content.
function record(type: number, content: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt8(1, 0);
  head.writeUInt8(type, 1);
  head.writeUInt16BE(1, 2);
  head.writeUInt16BE(content.length, 4);
  return Buffer.concat([head, content]);
}

// The name and value pairs of FastCGI parameters.
function parameters(pairs: Record<string, string>): Buffer {
  const length = (bytes: Buffer): Buffer => {
    if (bytes.length < 128) return Buffer.from([bytes.length]);
    const long = Buffer.alloc(4);
    long.writeUInt32BE(bytes.length | 0x80000000);
    return long;
  };
  return Buffer.concat(Object.entries(pairs).flatMap(([name, value]) => [length(Buffer.from(name)), length(Buffer.from(value)), Buffer.from(name), Buffer.from(value)]));
}

// Sends a body to a script of PHP-FPM as a web server does, in records of at most 65535 bytes, and resolves with the
// answer of the script, the output of the request without its header lines.
function overFastCgi(socket: string, script: string): Call {
  return (body) =>
    new Promise((resolve, reject) => {
      const connection = connect(socket);
      const received: Buffer[] = [];
      connection.on('error', reject);
      connection.on('data', (chunk: Buffer) => received.push(chunk));
      connection.on('end', () => {
        let rest = Buffer.concat(received);
        let output = '';
        while (rest.length >= 8) {
          const type = rest.readUInt8(1);
          const length = rest.readUInt16BE(4);
          const padding = rest.readUInt8(6);
          // The types 6 and 7 are the output and the errors of the script.
          if (type === 6 || type === 7) output += rest.subarray(8, 8 + length).toString('utf8');
          rest = rest.subarray(8 + length + padding);
        }
        try {
          resolve(answerOf(output.slice(output.indexOf('\r\n\r\n') + 4)));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
      // The role 1 is a responder; the flags 0 close the connection after the request.
      const begin = Buffer.alloc(8);
      begin.writeUInt16BE(1, 0);
      connection.write(record(1, begin));
      connection.write(record(4, parameters({ SCRIPT_FILENAME: script, REQUEST_METHOD: 'POST', CONTENT_TYPE: TYPE, CONTENT_LENGTH: String(statSync(body).size), REQUEST_URI: '/', SERVER_PROTOCOL: 'HTTP/1.1', GATEWAY_INTERFACE: 'CGI/1.1', QUERY_STRING: '' })));
      connection.write(record(4, Buffer.alloc(0)));
      const source = createReadStream(body, { highWaterMark: 65535 });
      source.on('error', reject);
      source.on('data', (chunk) => {
        // The stream waits while the connection holds what it was given.
        if (!connection.write(record(5, Buffer.from(chunk)))) {
          source.pause();
          connection.once('drain', () => source.resume());
        }
      });
      source.on('end', () => connection.write(record(5, Buffer.alloc(0))));
    });
}

// Starts PHP-FPM with one worker for a script, and resolves with the call of that script when its socket is there.
async function startFpm(name: string, script: string, reading: boolean): Promise<Call> {
  const env = environment(name);
  const socket = path.join(directory, `${name}.sock`);
  if (socket.length > 100) throw new Error(`the socket path ${socket} is longer than a UNIX socket address holds`);
  const configuration = path.join(directory, `${name}.conf`);
  writeFileSync(configuration, [
    '[global]',
    `error_log = ${path.join(directory, `${name}.log`)}`,
    'daemonize = no',
    '[bench]',
    `listen = ${socket}`,
    'pm = static',
    'pm.max_children = 1',
    'clear_env = no',
    `php_admin_value[post_max_size] = ${size + (1 << 30)}`,
    `php_admin_value[upload_max_filesize] = ${size + (1 << 30)}`,
    'php_admin_value[max_file_uploads] = 5000',
    'php_admin_value[max_input_vars] = 9000',
    'php_admin_value[max_multipart_body_parts] = 9000',
    'php_admin_value[memory_limit] = 64M',
    `php_admin_value[upload_tmp_dir] = ${env.TMPDIR}`,
    `php_admin_value[sys_temp_dir] = ${env.TMPDIR}`,
    `php_admin_flag[enable_post_data_reading] = ${reading ? 'on' : 'off'}`,
    '',
  ].join('\n'));
  const child = spawn('php-fpm', ['-y', configuration, '-c', '/dev/null'], { env: { ...process.env, ...env }, stdio: 'ignore' });
  children.push(child);
  // PHP-FPM prints no line when it listens; its socket is the event that tells it.
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`php-fpm of ${name} ended with ${code} before it listened; see ${path.join(directory, `${name}.log`)}`)));
    const poll = (): void => {
      if (existsSync(socket)) resolve();
      else setImmediate(poll);
    };
    poll();
  });
  return overFastCgi(socket, script);
}

interface Row { implementation: string; body: string; wall: number[]; cpu: number[]; rss: number; valid: boolean; held: number }
const rows: Row[] = [];

// Measures an implementation: one request without a file first, whose processor time is the base of the next, then
// `runs` requests of each body.
async function measure(implementation: string, call: Call, files: [string, string][], warm: string, php: boolean): Promise<void> {
  let before = (await call(warm)).cpu;
  for (const [label, body] of files) {
    const row: Row = { implementation, body: label, wall: [], cpu: [], rss: 0, valid: true, held: 0 };
    for (let run = 0; run < runs; run += 1) {
      const started = performance.now();
      const answer = await call(body);
      row.wall.push(performance.now() - started);
      row.cpu.push(answer.cpu - before);
      before = answer.cpu;
      row.rss = Math.max(row.rss, php || implementation.includes('Python') ? bytesOf(answer.rss) : answer.rss);
      row.valid &&= answer.valid;
      row.held = Math.max(row.held, answer.held);
    }
    rows.push(row);
    log(`${implementation}, ${label}: measured ${runs} requests`);
  }
}

try {
  await promisify(execFile)(process.execPath, [path.join(ROOT, 'scripts/contract-programs.mts'), '--contract', path.join(FIXTURE, 'application.json'), '--reads', path.join(FIXTURE, 'reads.json'), '--output', path.join(directory, 'applications')], { cwd: ROOT });
  const files = bodies();
  const warm = path.join(directory, 'warm');
  writeFileSync(warm, `--${BOUNDARY}\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--${BOUNDARY}--\r\n`);
  await measure('PHP itself (PHP-FPM)', await startFpm('native', path.join(ROOT, 'benchmarks/uploads-native.php'), true), files, warm, true);
  await measure('hyper PHP (PHP-FPM)', await startFpm('php', path.join(FIXTURE, 'public/index.php'), false), files, warm, true);
  const ready = /upload on (http:\/\/127\.0\.0\.1:\d+)/;
  const quiet = { ...process.env };
  const node = await startServer({ name: 'node', command: process.execPath, args: ['--no-warnings', path.join(FIXTURE, 'server.mjs')], env: { ...quiet, ...environment('node') }, ready, children });
  await measure('hyper Node (App.server)', overHttp(node.url), files, warm, false);
  const python = await startServer({ name: 'python', command: path.join(ROOT, 'packages/server/python/.venv/bin/python'), args: [path.join(FIXTURE, 'server.py')], env: { ...quiet, ...environment('python') }, ready, children });
  await measure('hyper Python (http.server)', overHttp(python.url), files, warm, false);
} finally {
  await stopServers(children);
  rmSync(directory, { recursive: true, force: true });
}

const mean = (list: number[]): number => list.reduce((sum, value) => sum + value, 0) / list.length;
const results = rows.map((row) => ({
  implementation: row.implementation,
  body: row.body,
  requests: row.wall.length,
  valid: row.valid,
  wallMs: { mean: mean(row.wall), min: Math.min(...row.wall), max: Math.max(...row.wall) },
  cpuMs: { mean: mean(row.cpu), min: Math.min(...row.cpu), max: Math.max(...row.cpu) },
  maxRssBytes: row.rss,
  directoriesHeld: row.held,
}));
if (values.json) {
  process.stdout.write(`${JSON.stringify(results)}\n`);
} else {
  const range = (value: { mean: number; min: number; max: number }): string => `${value.mean.toFixed(0)} (${value.min.toFixed(0)}-${value.max.toFixed(0)})`;
  for (const body of new Set(results.map((result) => result.body))) {
    log(`\n${body}, ${runs} requests each: the mean with the least and the most`);
    log('| implementation | server processor time ms | request time ms | largest memory of the server MiB |');
    log('|---|---|---|---|');
    for (const result of results.filter((item) => item.body === body).sort((a, b) => a.cpuMs.mean - b.cpuMs.mean)) {
      log(`| ${result.implementation} | ${range(result.cpuMs)} | ${range(result.wallMs)} | ${(result.maxRssBytes / 1048576).toFixed(1)} |`);
    }
  }
}
