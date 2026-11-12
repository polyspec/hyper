// The PHP, Node and Python servers read one request body with one result (HY-131): a seeded generator writes
// multipart bodies, well formed and malformed, and a few bodies at the limits of an application, and one real process
// of each server reads them in chunks. Every body must give the same values, files, failure and limit in the three
// servers, and no temporary file stays. The time and the processor time of each server are reported, not judged.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, readdirSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { requireBuilt } from './requires.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKERS = path.join(ROOT, 'tests/scripts/fixtures/multipart-worker');
const PYTHON = path.join(ROOT, 'packages/server/python/.venv/bin/python');
const COMMANDS = {
  php: ['php', path.join(WORKERS, 'worker.php')],
  node: [process.execPath, '--no-warnings', path.join(WORKERS, 'worker.mjs')],
  python: [PYTHON, path.join(WORKERS, 'worker.py')],
} as const;
type Server = keyof typeof COMMANDS;
const SERVERS: Server[] = ['php', 'node', 'python'];

interface Case {
  label: string;
  body: string;
  type: string;
  chunk: number;
  limit: number;
  valueLimit: number;
  partLimit: number;
  fileLimit: number;
  // What the body must give: whether it was read, whether it passed a limit, and its values and files.
  expects?: [boolean, boolean, number, number];
}
interface Line {
  result: [boolean, boolean, boolean, number, number, number, string];
  ms: number;
  cpu: number;
}

const BOUNDARY = 'XyZ7';
const TYPE = `multipart/form-data; boundary=${BOUNDARY}`;
const NONE = Number.MAX_SAFE_INTEGER;

// The generator of mulberry32: the same numbers for the same seed, so that the bodies of a run are those of every run.
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ['a', 'tags[]', 'user[address][0]', '0', '17', 'a.b c', '이름', 'é', ''];
const FILENAMES = ['a.txt', '보고서 (최종).pdf', 'C:\\dir\\a;b.txt', '', "it's.bin"];
const DISPOSITIONS = ['form-data', 'FORM-DATA', 'form-data ', 'attachment', 'form-dataX'];

// Returns the bytes of a multipart body of the generator: parts of text values, files and other parts, whose content
// may hold text that looks like a delimiter, and then one change that may break its form.
function generated(next: () => number): Buffer {
  const pick = (list: readonly string[]): string => {
    const item = list[Math.floor(next() * list.length)];
    if (item === undefined) throw new Error('the generator picked from an empty list');
    return item;
  };
  const bytes = (size: number): Buffer => Buffer.from(Array.from({ length: size }, () => Math.floor(next() * 256)));
  const chunks: Buffer[] = [];
  if (next() < 0.2) chunks.push(Buffer.from('a preamble\r\n'));
  const parts = Math.floor(next() * 9);
  for (let index = 0; index < parts; index += 1) {
    const kind = next();
    const quoted = next() < 0.9;
    const name = pick(NAMES);
    let header = `Content-Disposition: ${pick(DISPOSITIONS)}; name=${quoted ? `"${name}"` : name.replace(/[; \t"]/g, '_')}`;
    if (kind < 0.4) header += `; filename="${pick(FILENAMES)}"`;
    if (kind < 0.4 && next() < 0.5) header += '\r\nContent-Type: application/octet-stream';
    if (next() < 0.1) header += `\r\nX-Pad: ${'p'.repeat(Math.floor(next() * 9000))}`;
    let content = kind < 0.4 ? bytes(Math.floor(next() * 3000)) : Buffer.from(pick(['', '1', 'x=1&y=2', '값 №', `\r\n--${BOUNDARY.slice(0, 3)}`, `a--${BOUNDARY}b`, `\n--${BOUNDARY}`]));
    if (kind >= 0.4 && kind < 0.45) content = Buffer.concat([content, Buffer.from([0xff])]);
    // The content of a part holds no delimiter after a CRLF, which would end it (HY-131.3).
    while (content.includes(`\r\n--${BOUNDARY}`)) content = Buffer.from(content.toString('latin1').replace(`\r\n--${BOUNDARY}`, `\r\n-+${BOUNDARY}`), 'latin1');
    chunks.push(Buffer.from(`--${BOUNDARY}\r\n${header}\r\n\r\n`), content, Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  if (next() < 0.2) chunks.push(Buffer.from('an epilogue'));
  let body = Buffer.concat(chunks);
  const change = next();
  if (change < 0.1) body = body.subarray(0, Math.floor(next() * body.length));
  else if (change < 0.15) body = Buffer.from(body.toString('latin1').replace('\r\n\r\n', '\r\n'), 'latin1');
  else if (change < 0.2) body = Buffer.from(body.toString('latin1').replace(`--${BOUNDARY}\r\n`, `--${BOUNDARY}\n`), 'latin1');
  else if (change < 0.25) body = Buffer.from(body.toString('latin1').replace(`--${BOUNDARY}--`, `--${BOUNDARY}`), 'latin1');
  return body;
}

// Writes a part of a file of `size` bytes to the open file, one block of 1 MiB after another.
function filePart(target: number, name: string, size: number): void {
  writeSync(target, `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"; filename="${name}.bin"\r\n\r\n`);
  const block = Buffer.alloc(1 << 20, 0x61);
  for (let left = size; left > 0; left -= block.length) writeSync(target, block.subarray(0, Math.min(left, block.length)));
  writeSync(target, '\r\n');
}

// Tells whether a value is a line of a worker.
function isLine(value: unknown): value is Line {
  if (typeof value !== 'object' || value === null || !('result' in value) || !('ms' in value) || !('cpu' in value)) return false;
  return Array.isArray(value.result) && value.result.length === 7 && typeof value.ms === 'number' && typeof value.cpu === 'number';
}

// Runs the worker of a server over the cases, with the temporary directory of the test, and returns its lines.
async function run(server: Server, list: string, moved: string, temporary: string): Promise<Line[]> {
  const [command, ...prefix] = COMMANDS[server];
  const { stdout } = await promisify(execFile)(command, [...prefix, list, moved], { cwd: ROOT, env: { ...process.env, TMPDIR: temporary }, maxBuffer: 1 << 26 });
  return stdout.trim().split('\n').map((text) => {
    const line: unknown = JSON.parse(text);
    if (!isLine(line)) throw new Error(`the ${server} worker printed ${text}`);
    return line;
  });
}

test('the three servers read every generated body and every body at a limit with one result (HY-131)', { timeout: 600_000 }, async (t) => {
  requireBuilt('packages', 'packages/server/ts/dist/form/request-body.js');
  requireBuilt('hyper-install-python', 'packages/server/python/.venv/bin/python');
  requireBuilt('hyper-install-php', 'vendor/autoload.php');
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-multipart-compare-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const temporary = path.join(directory, 'tmp');
  const moved = path.join(directory, 'moved');
  mkdirSync(temporary);
  mkdirSync(moved);

  const cases: Case[] = [];
  const add = (label: string, bytes: Buffer | ((target: number) => void), options: Partial<Case> = {}): void => {
    const body = path.join(directory, `body-${cases.length}`);
    if (Buffer.isBuffer(bytes)) writeFileSync(body, bytes);
    else {
      const target = openSync(body, 'w');
      try {
        bytes(target);
      } finally {
        closeSync(target);
      }
    }
    cases.push({ label, body, type: TYPE, chunk: 65536, limit: NONE, valueLimit: NONE, partLimit: NONE, fileLimit: NONE, ...options });
  };
  const next = random(20261112);
  for (let index = 0; index < 300; index += 1) {
    const limited = next() < 0.3;
    add(`generated ${index}`, generated(next), {
      chunk: 1 + Math.floor(next() * (next() < 0.5 ? 16 : 5000)),
      valueLimit: limited && next() < 0.5 ? Math.floor(next() * 40) : NONE,
      partLimit: limited && next() < 0.5 ? Math.floor(next() * 6) : NONE,
      fileLimit: limited && next() < 0.5 ? Math.floor(next() * 2000) : NONE,
    });
  }
  const closing = `--${BOUNDARY}--\r\n`;
  const text = (name: string, value: string): string => `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  const SIZE = 256 * 1024 * 1024;
  const big = (target: number): void => {
    filePart(target, 'f', SIZE);
    writeSync(target, closing);
  };
  add('a file of 256 MiB', big, { expects: [true, false, 0, 1] });
  add('a file of 256 MiB at the file limit', big, { fileLimit: SIZE, expects: [true, false, 0, 1] });
  add('a file of 256 MiB one byte over the file limit', big, { fileLimit: SIZE - 1, expects: [false, true, 0, 0] });
  const thousand = Buffer.from(Array.from({ length: 1000 }, (_, index) => text(`v${index}`, 'x')).join('') + closing);
  add('1000 parts at the part limit', thousand, { partLimit: 1000, expects: [true, false, 1000, 0] });
  add('1000 parts one over the part limit', thousand, { partLimit: 999, expects: [false, true, 0, 0] });
  const values = Buffer.from(Array.from({ length: 2000 }, (_, index) => text(String(index % 10), 'y'.repeat(499))).join('') + closing);
  add('text values of 1000000 bytes at the value limit', values, { valueLimit: 1_000_000, expects: [true, false, 2000, 0] });
  add('text values of 1000000 bytes one over the value limit', values, { valueLimit: 999_999, expects: [false, true, 0, 0] });
  add('a body of 256 MiB over the body limit', big, { limit: 1024 * 1024, expects: [false, true, 0, 0] });
  add('a body read byte by byte', thousand.subarray(0, 20_000), { chunk: 1 });
  // The forms of three defects of the multipart reader of PHP, which each server must read alike. CVE-2024-8925: a
  // boundary longer than the buffer of that reader, 5 KiB, and content that holds a long prefix of the delimiter, which
  // made that reader drop the data between two delimiters.
  const long = 'B'.repeat(6000);
  const prefixed = `--${long}\r\nContent-Disposition: form-data; name="a"\r\n\r\nbefore\r\n--${long.slice(0, 5500)}\r\nafter\r\n--${long}\r\nContent-Disposition: form-data; name="b"\r\n\r\n2\r\n--${long}--\r\n`;
  for (const chunk of [5120, 8192, 4091]) add(`a boundary of 6000 characters with its prefix in the content, in chunks of ${chunk}`, Buffer.from(prefixed), { type: `multipart/form-data; boundary=${long}`, chunk, expects: [true, false, 2, 0] });
  // CVE-2023-0662: a body of very many parts, which that reader read to its end.
  add('100000 parts over a part limit of 1000', Buffer.from(text('p', '1').repeat(100_000) + closing), { partLimit: 1000, expects: [false, true, 0, 0] });
  // CVE-2015-4024: a part whose header never ends, which that reader read with a cost that grew with its square.
  add('a part header of 1 MiB without a line end', Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="a"; x=${'h'.repeat(1 << 20)}`), { expects: [false, false, 0, 0] });

  const list = path.join(directory, 'cases.json');
  writeFileSync(list, JSON.stringify(cases));
  const lines: Record<Server, Line[]> = { php: [], node: [], python: [] };
  for (const server of SERVERS) {
    lines[server] = await run(server, list, moved, temporary);
    assert.equal(lines[server].length, cases.length, `the ${server} worker printed ${lines[server].length} lines for ${cases.length} bodies`);
  }
  const differing: string[] = [];
  const kinds = { read: 0, failed: 0, exceeded: 0 };
  for (const [index, item] of cases.entries()) {
    const results = SERVERS.map((server) => JSON.stringify(lines[server][index]?.result));
    if (new Set(results).size !== 1) differing.push(`${item.label} (chunk ${item.chunk}): ${SERVERS.map((server, at) => `${server} ${results[at]}`).join('; ')}`);
    const [read, , exceeded, values, files] = lines.php[index]?.result ?? [false, false, false, 0, 0];
    if (item.expects !== undefined) assert.deepEqual([read, exceeded, values, files], item.expects, `${item.label}: read, over a limit, values, files`);
    kinds[exceeded ? 'exceeded' : read ? 'read' : 'failed'] += 1;
  }
  assert.deepEqual(differing, [], `${differing.length} of ${cases.length} bodies give another result in a server`);
  // The generator must give bodies of each kind, or the comparison compares nothing of it.
  for (const [kind, count] of Object.entries(kinds)) assert.ok(count >= 20, `only ${count} bodies are ${kind}`);
  assert.deepEqual(readdirSync(temporary), [], 'a server left a temporary file');
  assert.deepEqual(readdirSync(moved), [], 'a worker left a moved file');

  // The report: what each server used for the bodies at the limits; the processor time is that of the process so far.
  const report = [`multipart-compare: ${cases.length} bodies, ${kinds.read} read, ${kinds.failed} failed, ${kinds.exceeded} over a limit, one result in the three servers`];
  for (const [index, item] of cases.entries()) {
    if (item.label.startsWith('generated')) continue;
    report.push(`  ${item.label}: ${SERVERS.map((server) => `${server} ${lines[server][index]?.ms} ms`).join(', ')}`);
  }
  report.push(`  processor time of each process for all bodies: ${SERVERS.map((server) => `${server} ${lines[server].at(-1)?.cpu} ms`).join(', ')}`);
  process.stdout.write(`${report.join('\n')}\n`);
});
