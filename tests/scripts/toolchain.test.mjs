// Tests the toolchain of the repository (HY-81, scripts/toolchain.mjs): every tool is pinned in a tracked file, a tool
// that differs from its pin fails the check with the expected and the actual value, npm and Composer of this checkout
// come first on PATH, a download is used only with its pinned digest, and the recipes that run tools check the
// toolchain first. The Rust toolchain of the native extension build is checked by tests/scripts/template-copy.test.mjs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { BIN, COMPOSER, NPM, pins, problems, toolPath, verifiedDownload } from '../../scripts/toolchain.mjs';

test('the pins name an exact release of every tool', () => {
  const pinned = pins();
  assert.match(pinned.node, /^\d+\.\d+\.\d+$/);
  assert.match(pinned.npm.version, /^\d+\.\d+\.\d+$/);
  assert.match(pinned.npm.sha512, /^[0-9a-f]{128}$/);
  assert.match(pinned.php, /^\d+\.\d+\.\d+$/);
  assert.match(pinned.composer.version, /^\d+\.\d+\.\d+$/);
  assert.match(pinned.composer.sha256, /^[0-9a-f]{64}$/);
  assert.match(pinned.make, /^\d+\.\d+(\.\d+)?$/);
});

test('a packageManager without an exact release and its digest is refused with the expected form', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'hyper-toolchain-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'config'));
  writeFileSync(path.join(root, '.node-version'), '26.8.1\n');
  writeFileSync(path.join(root, 'config/toolchain.json'), '{}\n');
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ packageManager: 'npm@12.2.0' }));
  assert.throws(() => pins(root), /packageManager as npm@<major>\.<minor>\.<patch>\+sha512\.<128 hexadecimal digits>; it records "npm@12\.2\.0"/);
});

test('every tool that differs from its pin is named with the expected and the actual value', () => {
  const pinned = { ...pins(), node: '1.2.3', npm: { version: '0.0.1', sha512: 'f'.repeat(128) }, php: '0.0.0', composer: { version: '0.0.0', sha256: '0'.repeat(64) }, make: '0.1' };
  const found = problems({ pinned, make: '3.81' });
  assert.ok(found.includes(`Node.js: expected v1.2.3, actual ${process.version}`), found.join('\n'));
  assert.ok(found.some((line) => /^npm: expected 0\.0\.1, actual /.test(line)), found.join('\n'));
  assert.ok(found.some((line) => /^PHP: expected 0\.0\.0, actual \d+\.\d+\.\d+$/.test(line)), found.join('\n'));
  assert.ok(found.some((line) => line.startsWith(`Composer: expected ${'0'.repeat(64)}, actual `)), found.join('\n'));
  assert.ok(found.includes('make: expected 0.1, actual 3.81'), found.join('\n'));
});

test('npm and Composer of this checkout come first on PATH, once', () => {
  const entries = toolPath(['/usr/bin', BIN, '/bin'].join(path.delimiter)).split(path.delimiter);
  assert.deepEqual(entries, [BIN, '/usr/bin', '/bin']);
  assert.ok(BIN.endsWith(path.join('var', 'tools', 'bin')), BIN);
});

test('a download is used only with its pinned digest', async (t) => {
  const bytes = Buffer.from('release');
  const server = createServer((request, response) => response.end(bytes));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/release.tgz`;
  const sha512 = createHash('sha512').update(bytes).digest('hex');
  assert.deepEqual(await verifiedDownload(url, 'sha512', sha512), bytes);
  await assert.rejects(verifiedDownload(url, 'sha512', '0'.repeat(128)), new RegExp(`has the sha512 digest ${sha512}, expected the pinned ${'0'.repeat(128)}`));
});

test('the recipes that run npm, Composer, PHP or cargo check the toolchain first, and install installs the tools first', () => {
  const dryRun = (target) => {
    const result = spawnSync('make', ['--no-print-directory', '-n', target], { encoding: 'utf8', env: { ...process.env, MAKEFLAGS: '', MAKELEVEL: '' } });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.split('\n').filter(Boolean);
  };
  for (const target of ['template', 'lint', 'templates-check']) {
    assert.equal(dryRun(target)[0], `node scripts/toolchain.mjs check ${pins().make}`, target);
  }
  const install = dryRun('install');
  assert.deepEqual(install.slice(0, 2), ['node scripts/toolchain.mjs install', `node scripts/toolchain.mjs check ${pins().make}`]);
});

// The make of the pin looks up the program of a recipe line without shell syntax on the PATH of its own process: an
// exported PATH reaches the programs that the recipe starts, not the lookup of the recipe line itself.
test('make starts a recipe line without shell syntax from its own PATH, so a recipe names the pinned tool by its path', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-make-path-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(path.join(directory, 'bin'));
  writeFileSync(path.join(directory, 'bin', 'npm'), '#!/bin/sh\necho pinned\n');
  chmodSync(path.join(directory, 'bin', 'npm'), 0o755);
  writeFileSync(path.join(directory, 'Makefile'), `export PATH := ${directory}/bin:$(PATH)\nNPM := ${directory}/bin/npm\nsimple:\n\t@npm --version\nnamed:\n\t@$(NPM) --version\n`);
  const run = (target) => spawnSync('make', ['--no-print-directory', '-s', target], { cwd: directory, encoding: 'utf8', env: { ...process.env, MAKEFLAGS: '', MAKELEVEL: '' } }).stdout.trim();
  assert.notEqual(run('simple'), 'pinned', 'this make found the npm of the exported PATH; the absolute path is still required by the other makes of the rule');
  assert.equal(run('named'), 'pinned');
});

test('every recipe starts npm and Composer by the absolute paths of var/tools/bin', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-recipes-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const targets = ['install', 'template', 'packages', 'hyper-php-copy', 'package-check', 'test-scripts', 'test-node', 'test-php', 'lint', 'analyse-php', 'parity', 'server-parity', 'e2e', 'bundle-size'];
  const lines = [];
  for (const target of targets) {
    // An empty template directory makes the dry run print the recipe of the template copy.
    const result = spawnSync('make', ['--no-print-directory', '-n', target, `TEMPLATE_DIR=${directory}`], { encoding: 'utf8', env: { ...process.env, MAKEFLAGS: '', MAKELEVEL: '' } });
    assert.equal(result.status, 0, `${target}: ${result.stderr}`);
    lines.push(...result.stdout.split('\n').filter(Boolean));
  }
  // A command that a lock runs follows its --.
  const commands = lines.flatMap((line) => line.split(/&&|;|\|\||\s--\s/).map((part) => part.trim()));
  const tools = commands.filter((command) => /^(\S*\/)?(npm|npx|composer)( |$)/.test(command));
  assert.ok(tools.some((command) => command.startsWith(`${NPM} `)) && tools.some((command) => command.startsWith(`${COMPOSER} `)), lines.join('\n'));
  assert.deepEqual(tools.filter((command) => !command.startsWith(`${NPM} `) && !command.startsWith(`${COMPOSER} `)), []);
});
