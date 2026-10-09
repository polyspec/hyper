// Tests that outputs which other processes read are published without a missing or partly written file (HY-82,
// packages/hyper-build/lib/publish.mjs, writeFileAtomic of packages/hyper-build/lib/output-files.mjs): a reader polls an output while scripts write it
// again, concurrent writers of one output both succeed, an installed copy is published only while the package manager
// would install the same dependency tree.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { files } from '../../packages/hyper-build/lib/publish.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function temporary(t, prefix) {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// Starts a process that reads `paths` without pause until `stop` exists and resolves the number of reads that found
// a path missing or, for `contents`, a content that is not one of them.
// `contents` is the file of a JSON array of the contents that a read may find, or null.
function poll(paths, stop, contents = null) {
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
  return new Promise((resolve) => child.on('close', () => resolve(JSON.parse(output))));
}

// Linux refuses a single argument longer than MAX_ARG_STRLEN, 32 pages of 4 KiB, with E2BIG, where macOS limits only
// the sum of the arguments; every argument of a child process stays below it, so a case runs the same on both.
const ARGUMENT_LIMIT = 131072;
function checked(args) {
  for (const argument of args) assert.ok(Buffer.byteLength(argument) < ARGUMENT_LIMIT, `an argument of ${Buffer.byteLength(argument)} bytes is above the ${ARGUMENT_LIMIT} bytes that Linux allows one argument; give it in a file`);
  return args;
}

const node = (args, options = {}) => spawnSync(process.execPath, checked(args), { cwd: ROOT, encoding: 'utf8', ...options });

test('a reader of a package copy never finds a file missing while the copy is written again', async (t) => {
  const directory = temporary(t, 'hyper-publish-copy-');
  const output = path.join(directory, 'hyper-server-php');
  const first = node(['scripts/copy-package.mjs', '--path', 'packages/hyper-server-php', '--output', output]);
  assert.equal(first.status, 0, first.stderr);
  const stop = path.join(directory, 'stop');
  const reader = poll([path.join(output, 'composer.json'), path.join(output, 'src', 'App.php')], stop);
  for (let index = 0; index < 5; index++) {
    const again = node(['scripts/copy-package.mjs', '--path', 'packages/hyper-server-php', '--output', output]);
    assert.equal(again.status, 0, again.stderr);
  }
  writeFileSync(stop, '');
  const { reads, misses } = await reader;
  assert.ok(reads > 0);
  assert.equal(misses, 0, `${misses} of ${reads} reads found a file missing`);
  assert.deepEqual(files(output), spawnSync('git', ['ls-files', '--', '.'], { cwd: path.join(ROOT, 'packages/hyper-server-php'), encoding: 'utf8' }).stdout.split('\n').filter(Boolean).sort());
});

test('two writers of one copy both succeed and leave the complete copy', async (t) => {
  const directory = temporary(t, 'hyper-publish-writers-');
  const output = path.join(directory, 'hyper-server-php');
  const write = () => new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/copy-package.mjs', '--path', 'packages/hyper-server-php', '--output', output], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    child.stderr.on('data', (data) => { text += data; });
    child.on('close', (status) => resolve({ status, text }));
  });
  const results = await Promise.all([write(), write(), write()]);
  for (const result of results) assert.equal(result.status, 0, result.text);
  assert.ok(existsSync(path.join(output, 'composer.json')));
  assert.deepEqual(files(directory).filter((file) => !file.startsWith('hyper-server-php/')), []);
});

test('a reader of a file never reads a partial content while the file is written again', async (t) => {
  const directory = temporary(t, 'hyper-publish-file-');
  const file = path.join(directory, 'manifest.json');
  // The contents go to the writer and the reader in a file of another directory, because one of them is longer than
  // one argument may be on Linux.
  const contents = path.join(temporary(t, 'hyper-publish-contents-'), 'contents.json');
  writeFileSync(contents, JSON.stringify(['a'.repeat(200_000), 'b'.repeat(10)]));
  const script = `import { readFileSync } from 'node:fs';
    import { writeFileAtomic } from ${JSON.stringify(path.join(ROOT, 'packages/hyper-build/lib/output-files.mjs'))};
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

test('an installed copy is published only while the package manager would install the same dependency tree', (t) => {
  const directory = temporary(t, 'hyper-publish-installed-');
  const source = path.join(directory, 'package');
  const target = path.join(directory, 'vendor', 'polyspec', 'package');
  mkdirSync(path.join(source, 'bin'), { recursive: true });
  mkdirSync(target, { recursive: true });
  const manifest = { name: 'polyspec/package', bin: ['bin/run.php'], require: { php: '^8.2' }, autoload: { 'psr-4': { 'Polyspec\\Package\\': 'src/' } } };
  writeFileSync(path.join(source, 'composer.json'), JSON.stringify(manifest));
  writeFileSync(path.join(source, 'bin', 'run.php'), '<?php\n', { mode: 0o644 });
  writeFileSync(path.join(target, 'composer.json'), JSON.stringify(manifest));
  writeFileSync(path.join(target, 'stale.php'), '<?php\n');
  const published = node(['scripts/publish.mjs', 'composer-copy', source, target]);
  assert.equal(published.status, 0, published.stderr);
  assert.deepEqual(files(target), ['bin/run.php', 'composer.json']);
  // Composer makes the binaries of a package executable.
  assert.equal(statSync(path.join(target, 'bin', 'run.php')).mode & 0o111, 0o111);
  writeFileSync(path.join(source, 'composer.json'), JSON.stringify({ ...manifest, require: { php: '^8.3' } }));
  const changed = node(['scripts/publish.mjs', 'composer-copy', source, target]);
  assert.equal(changed.status, 1);
  assert.ok(changed.stderr.includes(`require of ${path.join(source, 'composer.json')} is {"php":"^8.3"}, the installed ${path.join(target, 'composer.json')} has {"php":"^8.2"}; run \`composer reinstall polyspec/package`), changed.stderr);
  assert.equal(JSON.parse(readFileSync(path.join(target, 'composer.json'), 'utf8')).require.php, '^8.2');
  const npmTarget = path.join(directory, 'node_modules', 'package');
  const missing = node(['scripts/publish.mjs', 'npm-copy', source, npmTarget]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /node_modules\/package is not installed; run `npm install`/);
});
