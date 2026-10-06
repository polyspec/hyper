// Tests the toolchain of the repository (HY-81, scripts/toolchain.mjs): every tool is pinned in a tracked file, a tool
// that differs from its pin fails the check with the expected and the actual value, npm and Composer of this checkout
// come first on PATH, a download is used only with its pinned digest, and the recipes that run tools check the
// toolchain first.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { BIN, COMPOSER, NPM, pins, problems, toolPath, verifiedDownload, versions } from '../../scripts/toolchain.mjs';
import { dryRun } from './make-dry-run.mjs';

test('the pins name an exact release of every tool', () => {
  const pinned = pins();
  assert.match(pinned.node, /^\d+\.\d+\.\d+$/);
  assert.match(pinned.npm.version, /^\d+\.\d+\.\d+$/);
  assert.match(pinned.npm.sha512, /^[0-9a-f]{128}$/);
  // PHP is pinned by its minor release; make is not pinned.
  assert.match(pinned.php, /^\d+\.\d+$/);
  assert.equal(pinned.make, undefined);
  assert.match(pinned.composer.version, /^\d+\.\d+\.\d+$/);
  assert.match(pinned.composer.sha256, /^[0-9a-f]{64}$/);
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

test('a patch release of the pinned PHP minor passes, and the full run can record the running releases', () => {
  const running = spawnSync('php', ['-r', 'echo PHP_MAJOR_VERSION, ".", PHP_MINOR_VERSION;'], { encoding: 'utf8' }).stdout;
  assert.deepEqual(problems({ pinned: { ...pins(), php: running } }).filter((line) => line.startsWith('PHP')), []);
  const recorded = versions();
  assert.match(recorded.php, new RegExp(`^${running.replace('.', '\\.')}\\.\\d+$`));
  assert.equal(recorded.node, process.version);
  assert.match(recorded.make, /^GNU Make \d/);
});

test('every tool that differs from its pin is named with the expected and the actual value', () => {
  const pinned = { ...pins(), node: '1.2.3', npm: { version: '0.0.1', sha512: 'f'.repeat(128) }, php: '0.0', composer: { version: '0.0.0', sha256: '0'.repeat(64) } };
  const found = problems({ pinned });
  assert.ok(found.includes(`Node.js: expected v1.2.3, actual ${process.version}`), found.join('\n'));
  assert.ok(found.some((line) => /^npm: expected 0\.0\.1, actual /.test(line)), found.join('\n'));
  assert.ok(found.some((line) => /^PHP: expected 0\.0, actual \d+\.\d+$/.test(line)), found.join('\n'));
  assert.ok(found.some((line) => line.startsWith(`Composer: expected ${'0'.repeat(64)}, actual `)), found.join('\n'));
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

test('the recipes that run npm, Composer or PHP check the toolchain first, and install installs the tools first', () => {
  for (const target of ['template', 'lint', 'templates-check']) {
    assert.equal(dryRun(target)[0], 'node scripts/toolchain.mjs check', target);
  }
  const install = dryRun('install');
  assert.deepEqual(install.slice(0, 2), ['env -u npm_config_offline -u COMPOSER_DISABLE_NETWORK node scripts/toolchain.mjs install', 'node scripts/toolchain.mjs check']);
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
  // GNU Make 3.81 runs the npm of its own PATH for the simple line; a recipe that names the path runs the pinned tool
  // under every make.
  if (/^GNU Make 3\.81\b/.test(spawnSync('make', ['--version'], { encoding: 'utf8' }).stdout)) assert.notEqual(run('simple'), 'pinned');
  assert.equal(run('named'), 'pinned');
});

test('every recipe starts npm and Composer by the absolute paths of var/tools/bin', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-recipes-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const targets = ['install', 'template', 'packages', 'hyper-php-copy', 'package-check', 'test-scripts', 'test-node', 'test-php', 'lint', 'analyse-php', 'parity', 'server-parity', 'e2e', 'bundle-size'];
  const lines = [];
  for (const target of targets) {
    // An empty template directory makes the dry run print the recipe of the template copy.
    lines.push(...dryRun(target, { variables: [`TEMPLATE_DIR=${directory}`] }));
  }
  // A command that a lock runs follows its --.
  const commands = lines.flatMap((line) => line.split(/&&|;|\|\||\s--\s/).map((part) => part.trim()));
  const tools = commands.filter((command) => /^(\S*\/)?(npm|npx|composer)( |$)/.test(command));
  assert.ok(tools.some((command) => command.startsWith(`${NPM} `)) && tools.some((command) => command.startsWith(`${COMPOSER} `)), lines.join('\n'));
  assert.deepEqual(tools.filter((command) => !command.startsWith(`${NPM} `) && !command.startsWith(`${COMPOSER} `)), []);
});

test('no recipe queries a registry: installs follow their lock without an audit, and the package install test installs offline (HY-89)', () => {
  const targets = ['install', 'template', 'packages', 'hyper-php-copy', 'package-check', 'test-scripts', 'test-js', 'test-node', 'test-php', 'lint', 'analyse-php', 'parity', 'server-parity', 'e2e', 'bundle-size', 'templates-check', 'docs-check'];
  const lines = targets.flatMap((target) => dryRun(target, { variables: ['TEMPLATE_DIR=var/products/template-dry-run'] }));
  const commands = lines.flatMap((line) => line.split(/&&|;|\|\||\s--\s/).map((part) => part.trim()));
  const npm = commands.filter((command) => command.startsWith(`${NPM} `));
  assert.ok(npm.length > 0, lines.join('\n'));
  assert.deepEqual(npm.filter((command) => !/^\S+ (ci|run) /.test(command)), [], 'an npm command other than ci or run');
  assert.deepEqual(npm.filter((command) => / ci /.test(command) && !command.includes('--no-audit')), []);
  assert.ok(npm.some((command) => / ci --offline /.test(command)), 'the package install test installs offline');
  const composer = commands.filter((command) => command.startsWith(`${COMPOSER} `));
  assert.deepEqual(composer.filter((command) => !/^\S+ install /.test(command)), [], 'a Composer command other than install');
  assert.equal(spawnSync('git', ['ls-files', '--error-unmatch', 'tests/package-install/package-lock.json'], { encoding: 'utf8' }).status, 0, 'tests/package-install/package-lock.json is not tracked');
});

// The settings that keep npm and Composer from reading the network, and the prefix of the downloads that lift
// them (HY-89).
const OFFLINE = { npm_config_offline: 'true', COMPOSER_DISABLE_NETWORK: '1' };
const ONLINE = `env ${Object.keys(OFFLINE).map((name) => `-u ${name}`).join(' ')} `;

test('every recipe runs npm and Composer offline, and $(ONLINE) lifts it (HY-89)', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-offline-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const extra = path.join(directory, 'env.mk');
  writeFileSync(extra, 'hyper-recipe-env:\n\t@env\nhyper-online-env:\n\t@$(ONLINE) env\n');
  const caller = ['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL', 'MAKEOVERRIDES', ...Object.keys(OFFLINE)];
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !caller.includes(name)));
  const run = (target) => {
    const result = spawnSync('make', ['--no-print-directory', '-s', '-f', 'Makefile', '-f', extra, target], { encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stderr);
    return Object.fromEntries(result.stdout.split('\n').filter((line) => line.includes('=')).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  };
  const recipe = run('hyper-recipe-env');
  for (const [name, value] of Object.entries(OFFLINE)) assert.equal(recipe[name], value, `${name} of a recipe`);
  const online = run('hyper-online-env');
  for (const name of Object.keys(OFFLINE)) assert.equal(online[name], undefined, `${name} under $(ONLINE)`);
});

test('only make tools, make install and make install-browser download, each download through $(ONLINE), and no check target downloads (HY-89)', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-downloads-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.deepEqual(dryRun('tools'), [`${ONLINE}node scripts/toolchain.mjs install`]);
  assert.deepEqual(dryRun('install-browser'), [`${ONLINE}node node_modules/@playwright/test/cli.js install --with-deps chromium`]);
  const install = dryRun('install', { variables: [`TEMPLATE_DIR=${directory}`] });
  const downloads = install.filter((line) => / ci |composer install|toolchain\.mjs install/.test(line.replace(/ -- /, ' ')));
  assert.ok(downloads.length > 0, install.join('\n'));
  assert.deepEqual(downloads.filter((line) => !line.includes(ONLINE)), [], 'a download of make install without $(ONLINE)');
  // An empty template directory makes each dry run print the recipe of the template copy as well.
  const checks = /^CHECK_TARGETS := (.+)$/m.exec(readFileSync('Makefile', 'utf8'))[1].split(' ');
  assert.ok(checks.length > 10, checks.join(' '));
  for (const target of [...checks, 'ext', 'template']) {
    const lines = dryRun(target, { variables: [`TEMPLATE_DIR=${directory}`] });
    assert.deepEqual(lines.filter((line) => /env -u/.test(line)), [], `${target} downloads`);
  }
});
