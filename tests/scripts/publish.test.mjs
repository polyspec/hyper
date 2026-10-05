// Tests that outputs which other processes read are published without a missing or partly written file (HY-82,
// scripts/publish.mjs, writeFileAtomic of scripts/output-files.mjs): a reader polls an output while scripts write it
// again, concurrent writers of one output both succeed, an installed copy is published only while the package manager
// would install the same dependency tree, and the package manager installs and the full run hold a lock.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { files } from '../../scripts/publish.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function temporary(t, prefix) {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// Starts a process that reads `paths` without pause until `stop` exists and resolves the number of reads that found
// a path missing or, for `contents`, a content that is not one of them.
function poll(paths, stop, contents = null) {
  const code = `
    const { existsSync, readFileSync } = require('node:fs');
    const [paths, stop, contents] = JSON.parse(process.argv[1]);
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
  const child = spawn(process.execPath, ['-e', code, JSON.stringify([paths, stop, contents])], { stdio: ['ignore', 'pipe', 'inherit'] });
  let output = '';
  child.stdout.on('data', (data) => { output += data; });
  return new Promise((resolve) => child.on('close', () => resolve(JSON.parse(output))));
}

const node = (args, options = {}) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', ...options });

test('a reader of a package copy never finds a file missing while the copy is written again', async (t) => {
  const directory = temporary(t, 'hyper-publish-copy-');
  const output = path.join(directory, 'hyper-php');
  const first = node(['scripts/copy-package.mjs', '--path', 'packages/hyper-php', '--output', output]);
  assert.equal(first.status, 0, first.stderr);
  const stop = path.join(directory, 'stop');
  const reader = poll([path.join(output, 'composer.json'), path.join(output, 'src', 'App.php')], stop);
  for (let index = 0; index < 5; index++) {
    const again = node(['scripts/copy-package.mjs', '--path', 'packages/hyper-php', '--output', output]);
    assert.equal(again.status, 0, again.stderr);
  }
  writeFileSync(stop, '');
  const { reads, misses } = await reader;
  assert.ok(reads > 0);
  assert.equal(misses, 0, `${misses} of ${reads} reads found a file missing`);
  assert.deepEqual(files(output), spawnSync('git', ['ls-files', '--', '.'], { cwd: path.join(ROOT, 'packages/hyper-php'), encoding: 'utf8' }).stdout.split('\n').filter(Boolean).sort());
});

test('two writers of one copy both succeed and leave the complete copy', async (t) => {
  const directory = temporary(t, 'hyper-publish-writers-');
  const output = path.join(directory, 'hyper-php');
  const write = () => new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/copy-package.mjs', '--path', 'packages/hyper-php', '--output', output], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    child.stderr.on('data', (data) => { text += data; });
    child.on('close', (status) => resolve({ status, text }));
  });
  const results = await Promise.all([write(), write(), write()]);
  for (const result of results) assert.equal(result.status, 0, result.text);
  assert.ok(existsSync(path.join(output, 'composer.json')));
  assert.deepEqual(files(directory).filter((file) => !file.startsWith('hyper-php/')), []);
});

test('a reader of a file never reads a partial content while the file is written again', async (t) => {
  const directory = temporary(t, 'hyper-publish-file-');
  const file = path.join(directory, 'manifest.json');
  const contents = ['a'.repeat(200_000), 'b'.repeat(10)];
  const script = `import { writeFileAtomic } from ${JSON.stringify(path.join(ROOT, 'scripts/output-files.mjs'))};
    for (let index = 0; index < 300; index++) writeFileAtomic(${JSON.stringify(file)}, ${JSON.stringify(contents)}[index % 2]);`;
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

test('a package manager install holds the install lock, and a second one fails with the holder', async (t) => {
  const directory = temporary(t, 'hyper-publish-lock-');
  const lock = path.join(directory, 'install.lock');
  const started = path.join(directory, 'started');
  const stop = path.join(directory, 'stop');
  const first = spawn(process.execPath, ['scripts/holder-lock.mjs', 'run', lock, '--', process.execPath, '-e',
    `require('node:fs').writeFileSync(${JSON.stringify(started)}, ''); while (!require('node:fs').existsSync(${JSON.stringify(stop)})) {}`], { cwd: ROOT, stdio: 'inherit' });
  const firstEnd = new Promise((resolve) => first.on('close', resolve));
  while (!existsSync(started)) await new Promise((resolve) => setTimeout(resolve, 10));
  const second = node(['scripts/holder-lock.mjs', 'run', lock, '--', process.execPath, '-e', '']);
  assert.equal(second.status, 1);
  assert.match(second.stderr, new RegExp(`install\\.lock is held by process ${first.pid} of the checkout ${ROOT.replaceAll('/', '\\/')}`));
  writeFileSync(stop, '');
  assert.equal(await firstEnd, 0);
  assert.equal(existsSync(lock), false);
  assert.equal(node(['scripts/holder-lock.mjs', 'run', lock, '--', process.execPath, '-e', 'process.exit(3)']).status, 3);
});
