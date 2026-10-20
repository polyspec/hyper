// Tests that outputs which other processes read are published without a missing or partly written file (HR-82,
// packages/build/lib/publish.mjs, writeFileAtomic of packages/build/lib/output-files.mjs): a reader polls an output while scripts write it
// again, and concurrent writers of one output both succeed.
import assert from 'node:assert/strict';
import { spawn, spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

import { files } from '../../packages/build/lib/publish.mjs';
import { jsonNumber, parseJsonObject } from '../../scripts/json.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function temporary(t: TestContext, prefix: string) {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// Starts a process that reads `paths` without pause until `stop` exists and resolves the number of reads that found
// a path missing or, for `contents`, a content that is not one of them.
// `contents` is the file of a JSON array of the contents that a read may find, or null.
function poll(paths: string[], stop: string, contents: string | null = null): Promise<{ reads: number; misses: number }> {
  const code = `
    const { existsSync, readFileSync } = require('node:fs');
    const [paths, stop, file] = JSON.parse(process.argv[1]);
    const contents = file && JSON.parse(readFileSync(file, 'utf8'));
    let reads = 0; let misses = 0;
    while (!existsSync(stop)) {
      for (const file of paths) {
        reads++;
        try {
          const text = readFileSync(file, 'utf8');
          if (contents && !contents.includes(text)) misses++;
        } catch { misses++; }
      }
    }
    process.stdout.write(JSON.stringify({ reads, misses }));`;
  const child = spawn(process.execPath, checked(['-e', code, JSON.stringify([paths, stop, contents])]), { stdio: ['ignore', 'pipe', 'inherit'] });
  let output = '';
  child.stdout.on('data', (data) => { output += data; });
  return new Promise((resolve) => child.on('close', () => {
    const counts = parseJsonObject(output, 'the output of the reader');
    resolve({ reads: jsonNumber(counts.reads, 'reads'), misses: jsonNumber(counts.misses, 'misses') });
  }));
}

// Linux refuses a single argument longer than MAX_ARG_STRLEN, 32 pages of 4 KiB, with E2BIG, where macOS limits only
// the sum of the arguments; every argument of a child process stays below it, so a case runs the same on both.
const ARGUMENT_LIMIT = 131072;
function checked(args: string[]) {
  for (const argument of args) assert.ok(Buffer.byteLength(argument) < ARGUMENT_LIMIT, `an argument of ${Buffer.byteLength(argument)} bytes is above the ${ARGUMENT_LIMIT} bytes that Linux allows one argument; give it in a file`);
  return args;
}

const node = (args: string[], options: Partial<SpawnSyncOptionsWithStringEncoding> = {}) => spawnSync(process.execPath, checked(args), { cwd: ROOT, encoding: 'utf8', ...options });

// A staging directory with the files of `names`, each holding its name, as a build writes it before scripts/publish.mts.
function stage(directory: string, name: string, names: string[]) {
  const staged = path.join(directory, name);
  for (const file of names) {
    mkdirSync(path.dirname(path.join(staged, file)), { recursive: true });
    writeFileSync(path.join(staged, file), file);
  }
  return staged;
}

test('a reader of a published directory never finds a file missing while the directory is published again', async (t) => {
  const directory = temporary(t, 'hyper-publish-directory-');
  const output = path.join(directory, 'dist');
  const names = ['index.js', 'index.d.ts', 'lib/router.js'];
  const first = node(['scripts/publish.mts', 'directory', stage(directory, 'dist.next-0', names), output]);
  assert.equal(first.status, 0, first.stderr);
  const stop = path.join(directory, 'stop');
  const reader = poll(names.map((name) => path.join(output, name)), stop);
  for (let index = 1; index <= 5; index++) {
    const again = node(['scripts/publish.mts', 'directory', stage(directory, `dist.next-${index}`, names), output]);
    assert.equal(again.status, 0, again.stderr);
  }
  writeFileSync(stop, '');
  const { reads, misses } = await reader;
  assert.ok(reads > 0);
  assert.equal(misses, 0, `${misses} of ${reads} reads found a file missing`);
  assert.deepEqual(files(output), [...names].sort());
});

test('two writers of one directory both succeed and leave the complete directory', async (t) => {
  const directory = temporary(t, 'hyper-publish-writers-');
  const output = path.join(directory, 'dist');
  const names = ['index.js', 'index.d.ts', 'lib/router.js'];
  const write = (index: number) => new Promise<{ status: number | null; text: string }>((resolve) => {
    const child = spawn(process.execPath, ['scripts/publish.mts', 'directory', stage(directory, `dist.next-${index}`, names), output], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    child.stderr.on('data', (data: Buffer) => { text += data.toString(); });
    child.on('close', (status) => resolve({ status, text }));
  });
  const results = await Promise.all([write(1), write(2), write(3)]);
  for (const result of results) assert.equal(result.status, 0, result.text);
  assert.deepEqual(files(output), [...names].sort());
});

test('a reader of a file never reads a partial content while the file is written again', async (t) => {
  const directory = temporary(t, 'hyper-publish-file-');
  const file = path.join(directory, 'manifest.json');
  // The contents go to the writer and the reader in a file of another directory, because one of them is longer than
  // one argument may be on Linux.
  const contents = path.join(temporary(t, 'hyper-publish-contents-'), 'contents.json');
  writeFileSync(contents, JSON.stringify(['a'.repeat(200_000), 'b'.repeat(10)]));
  const script = `import { readFileSync } from 'node:fs';
    import { writeFileAtomic } from ${JSON.stringify(path.join(ROOT, 'packages/build/lib/output-files.mjs'))};
    const contents = JSON.parse(readFileSync(${JSON.stringify(contents)}, 'utf8'));
    for (let index = 0; index < 300; index++) writeFileAtomic(${JSON.stringify(file)}, contents[index % 2]);`;
  node(['--input-type=module', '-e', script]);
  const stop = path.join(directory, 'stop');
  const reader = poll([file], stop, contents);
  const writer = node(['--input-type=module', '-e', script]);
  assert.equal(writer.status, 0, writer.stderr);
  writeFileSync(stop, '');
  const { reads, misses } = await reader;
  assert.ok(reads > 0);
  assert.equal(misses, 0, `${misses} of ${reads} reads found the file missing or partly written`);
  assert.deepEqual(files(directory).sort(), ['manifest.json', 'stop']);
});

