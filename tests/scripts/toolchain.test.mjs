// Tests how the recipes of the Makefile use the toolchain (HY-81, HY-89): the recipes that run tools check the
// toolchain first, npm and Composer of this checkout are started by the absolute paths of var/tools/bin, every recipe
// runs npm and Composer offline, only the install targets download, and the package manager installs hold the install
// lock. The tools themselves (scripts/kit/install-tools.mjs, scripts/kit/check-toolchain.mjs) are tested in
// tests/kit.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { dryRun } from './make-dry-run.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NPM = path.join(ROOT, 'var/tools/bin/npm');
const COMPOSER = path.join(ROOT, 'var/tools/bin/composer');

test('the recipes that run npm, Composer or PHP check the toolchain first, and install installs the tools first', () => {
  for (const target of ['ext', 'lint', 'templates-check']) {
    assert.equal(dryRun(target)[0].trim(), 'node scripts/kit/check-toolchain.mjs', target);
  }
  const install = dryRun('install');
  assert.deepEqual(install.slice(0, 2).map((line) => line.trim()), ['env -u npm_config_offline -u COMPOSER_DISABLE_NETWORK node scripts/kit/install-tools.mjs', 'node scripts/kit/check-toolchain.mjs']);
});

test('the package manager installs of make install run under the install lock', () => {
  const lines = dryRun('install', { variables: ['TEMPLATE_DIR=var/products/template-dry-run'] });
  const installs = lines.filter((line) => / ci | install( |$)/.test(line) && /(npm|composer) /.test(line));
  assert.equal(installs.length, 3, lines.join('\n'));
  assert.deepEqual(installs.filter((line) => !line.includes('node scripts/kit/holder-lock.mjs run var/install.lock -- ')), []);
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
  const targets = ['install', 'ext', 'packages', 'hyper-php-copy', 'package-check', 'test-scripts', 'test-node', 'test-php', 'lint', 'analyse-php', 'parity', 'server-parity', 'e2e', 'bundle-size'];
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
  const targets = ['install', 'ext', 'packages', 'hyper-php-copy', 'package-check', 'test-scripts', 'test-js', 'test-node', 'test-php', 'lint', 'analyse-php', 'parity', 'server-parity', 'e2e', 'bundle-size', 'templates-check', 'documents-check'];
  const lines = targets.flatMap((target) => dryRun(target, { variables: ['TEMPLATE_DIR=var/products/template-dry-run'] }));
  const commands = lines.flatMap((line) => line.split(/&&|;|\|\||\s--\s/).map((part) => part.trim()));
  const npm = commands.filter((command) => command.startsWith(`${NPM} `));
  assert.ok(npm.length > 0, lines.join('\n'));
  assert.deepEqual(npm.filter((command) => !/^\S+ (ci|run) /.test(command)), [], 'an npm command other than ci or run');
  assert.deepEqual(npm.filter((command) => / ci /.test(command) && !command.includes('--no-audit')), []);
  assert.ok(npm.some((command) => / ci --offline /.test(command)), 'the package install test installs offline');
  const composer = commands.filter((command) => command.startsWith(`${COMPOSER} `));
  assert.deepEqual(composer.filter((command) => !/^\S+ install(?: |$)/.test(command)), [], 'a Composer command other than install');
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

test('only make install-tools, make install and make install-browser download, each download through $(ONLINE), and no check target downloads (HY-89)', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-downloads-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.deepEqual(dryRun('install-tools').map((line) => line.trim()), [`${ONLINE}node scripts/kit/install-tools.mjs`]);
  assert.deepEqual(dryRun('install-browser'), [`${ONLINE}node node_modules/@playwright/test/cli.js install --with-deps chromium`]);
  const install = dryRun('install', { variables: [`TEMPLATE_DIR=${directory}`] });
  const downloads = install.filter((line) => / ci |composer install|install-tools\.mjs/.test(line.replace(/ -- /, ' ')));
  assert.ok(downloads.length > 0, install.join('\n'));
  assert.deepEqual(downloads.filter((line) => !line.includes(ONLINE)), [], 'a download of make install without $(ONLINE)');
  // An empty template directory makes each dry run print the recipe of the template copy as well.
  const checks = /^CHECK_TARGETS := (.+)$/m.exec(readFileSync('Makefile', 'utf8'))[1].split(' ');
  assert.ok(checks.length > 10, checks.join(' '));
  for (const target of [...checks, 'ext']) {
    const lines = dryRun(target, { variables: [`TEMPLATE_DIR=${directory}`] });
    assert.deepEqual(lines.filter((line) => /env -u/.test(line)), [], `${target} downloads`);
  }
});
