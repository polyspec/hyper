// Tests how the recipes of the Makefile use the toolchain (HR-81, HR-89): the recipes that run tools check the
// toolchain first, npm and Composer of the main checkout are started by the absolute paths of its var/tools, every recipe
// runs npm and Composer offline, only the install targets download, and the package manager installs hold the install
// lock. The tools themselves (install-tools and check-toolchain of @polyspec/kit) are tested in kit.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { dryRun } from './make-dry-run.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// The main checkout of ROOT, the folder of the common Git directory: a linked worktree runs its tools and installs none (kit K519).
const commonDir = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' });
if (commonDir.status !== 0) throw new Error(`git rev-parse --git-common-dir in ${ROOT}: ${commonDir.stderr}`);
const MAIN = realpathSync(path.dirname(commonDir.stdout.trim()));
const WORKTREE = realpathSync(ROOT) !== MAIN;
const TOOLS = path.join(MAIN, 'var/tools');
const NPM = path.join(TOOLS, 'bin/npm');
// The node of mise.toml, which the bootstrap wraps in var/tools/bin and kit.mk names $(NODE) (kit K171).
const NODE = path.join(TOOLS, 'bin/node');
// Composer is a tool of mise.toml, run by its shim (kit K127).
const COMPOSER = path.join(TOOLS, 'mise/shims/composer');
// The built tools of @polyspec/kit, which the kit.mk of the package runs: the kit checkout beside the repository when there is one,
// which the link installs (scripts/kit/kit-bootstrap.mk, K448), else the installed package.
const KIT = existsSync(path.join(ROOT, '../kit/.git')) ? '../kit/dist' : 'node_modules/@polyspec/kit/dist';
// The commands of recipe lines: a command that a lock runs follows its --, and the variable assignments before a command, as
// NPM_BIN=<npm> of the recipe npm-install of kit, are its environment, not the command.
const commandsOf = (lines: string[]) => lines.flatMap((line) => line.split(/&&|;|\|\||\s--\s/).map((part) => part.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '')));

test('the recipes that run npm, Composer or PHP check the toolchain first, and install installs the tools first', () => {
  for (const target of ['ext', 'hyper-lint', 'templates-check']) {
    assert.equal(dryRun(target)[0]?.trim(), `${NODE} ${KIT}/check-toolchain.mjs`, target);
  }
  // make hyper-install is judged as the main checkout runs it: a worktree installs no tools and runs those of the main
  // checkout (kit K519), so its install-kit prints the refusal of K519; the dry run of the main checkout reads only.
  const install = dryRun('hyper-install', { cwd: MAIN });
  // install-kit of kit installs npm, the packages and then the tools; the tools come before the first check of the toolchain.
  const lines = install.map((line) => line.trim());
  const tools = lines.indexOf(`env -u npm_config_offline -u COMPOSER_DISABLE_NETWORK ${NODE} ${KIT}/install-tools.mjs`);
  const check = lines.indexOf(`${NODE} ${KIT}/check-toolchain.mjs`);
  assert.ok(tools >= 0 && check > tools, install.join('\n'));
});

test('the package manager installs of make hyper-install run under the install lock', () => {
  const lines = dryRun('hyper-install', { variables: ['TEMPLATE_DIR=var/products/template-dry-run'] });
  const installs = lines.filter((line) => / ci | install( |$)/.test(line) && /(npm|composer) /.test(line));
  assert.equal(installs.length, 2, lines.join('\n'));
  assert.deepEqual(installs.filter((line) => !line.includes(`${NODE} ${KIT}/holder-lock.mjs run var/install.lock -- `)), []);
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
  const run = (target: string) => spawnSync('make', ['--no-print-directory', '-s', target], { cwd: directory, encoding: 'utf8', env: { ...process.env, MAKEFLAGS: '', MAKELEVEL: '' } }).stdout.trim();
  // GNU Make 3.81 runs the npm of its own PATH for the simple line; a recipe that names the path runs the pinned tool
  // under every make.
  if (/^GNU Make 3\.81\b/.test(spawnSync('make', ['--version'], { encoding: 'utf8' }).stdout)) assert.notEqual(run('simple'), 'pinned');
  assert.equal(run('named'), 'pinned');
});

test('every recipe starts npm and Composer by the absolute paths of var/tools/bin and of the shims of mise', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-recipes-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const targets = ['hyper-install', 'ext', 'packages', 'hyper-server-php-install', 'package-check', 'hyper-test-scripts', 'hyper-test-node', 'hyper-test-php', 'hyper-lint', 'analyse-php', 'parity', 'server-parity', 'e2e', 'bundle-size'];
  const lines = [];
  for (const target of targets) {
    // An empty template directory makes the dry run print the recipe of the template copy.
    lines.push(...dryRun(target, { variables: [`TEMPLATE_DIR=${directory}`] }));
  }
  const commands = commandsOf(lines);
  const tools = commands.filter((command) => /^(\S*\/)?(npm|npx|composer)( |$)/.test(command));
  assert.ok(tools.some((command) => command.startsWith(`${NPM} `)) && tools.some((command) => command.startsWith(`${COMPOSER} `)), lines.join('\n'));
  assert.deepEqual(tools.filter((command) => !command.startsWith(`${NPM} `) && !command.startsWith(`${COMPOSER} `)), []);
});

test('no recipe queries a registry: installs follow their lock without an audit, and the package install test installs offline (HR-89)', () => {
  const targets = ['hyper-install', 'ext', 'packages', 'hyper-server-php-install', 'package-check', 'hyper-test-scripts', 'hyper-test-js', 'hyper-test-node', 'hyper-test-php', 'hyper-lint', 'analyse-php', 'parity', 'server-parity', 'e2e', 'bundle-size', 'templates-check', 'docs-check'];
  const lines = targets.flatMap((target) => dryRun(target, { variables: ['TEMPLATE_DIR=var/products/template-dry-run'] }));
  const commands = commandsOf(lines);
  const npm = commands.filter((command) => command.startsWith(`${NPM} `));
  assert.ok(npm.length > 0, lines.join('\n'));
  assert.deepEqual(npm.filter((command) => !/^\S+ (ci|run) /.test(command)), [], 'an npm command other than ci or run');
  assert.deepEqual(npm.filter((command) => / ci /.test(command) && !command.includes('--no-audit')), []);
  assert.ok(npm.some((command) => / ci --offline /.test(command)), 'the package install test installs offline');
  // The npm ci of make install-packages is the recipe of @polyspec/kit, so the .npmrc of the checkout turns its audit off.
  assert.match(readFileSync(path.join(ROOT, '.npmrc'), 'utf8'), /^audit=false$/m, '.npmrc does not set audit=false');
  const composer = commands.filter((command) => command.startsWith(`${COMPOSER} `));
  assert.deepEqual(composer.filter((command) => !/^\S+ (?:re)?install(?: |$)/.test(command)), [], 'a Composer command other than install or reinstall');
  assert.equal(spawnSync('git', ['ls-files', '--error-unmatch', 'tests/package-install/package-lock.json'], { encoding: 'utf8' }).status, 0, 'tests/package-install/package-lock.json is not tracked');
});

// The settings that keep npm and Composer from reading the network, and the prefix of the downloads that lift
// them (HR-89).
const OFFLINE = { npm_config_offline: 'true', COMPOSER_DISABLE_NETWORK: '1' };
const ONLINE = `env ${Object.keys(OFFLINE).map((name) => `-u ${name}`).join(' ')} `;

test('every recipe runs npm and Composer offline, and $(ONLINE) lifts it (HR-89)', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-offline-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const extra = path.join(directory, 'env.mk');
  writeFileSync(extra, 'hyper-recipe-env:\n\t@env\nhyper-online-env:\n\t@$(ONLINE) env\n');
  const caller = ['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL', 'MAKEOVERRIDES', ...Object.keys(OFFLINE)];
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !caller.includes(name)));
  const run = (target: string) => {
    const result = spawnSync('make', ['--no-print-directory', '-s', '-f', 'Makefile', '-f', extra, target], { encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stderr);
    return Object.fromEntries(result.stdout.split('\n').filter((line) => line.includes('=')).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  };
  const recipe = run('hyper-recipe-env');
  for (const [name, value] of Object.entries(OFFLINE)) assert.equal(recipe[name], value, `${name} of a recipe`);
  const online = run('hyper-online-env');
  for (const name of Object.keys(OFFLINE)) assert.equal(online[name], undefined, `${name} under $(ONLINE)`);
});

test('only make install-tools, make install-packages, make hyper-install and make hyper-install-browser download, each download through $(ONLINE), and no check target downloads (HR-89)', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-downloads-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  // A worktree installs no tools, so its install-tools prints the refusal of kit K519; the main checkout downloads them.
  if (!WORKTREE) assert.deepEqual(dryRun('install-tools').map((line) => line.trim()), [`${ONLINE}${NODE} ${KIT}/install-tools.mjs`]);
  assert.deepEqual(dryRun('install-packages'), [`${ONLINE}${NPM} ci`]);
  assert.deepEqual(dryRun('hyper-install-browser'), [`${ONLINE}${NODE} node_modules/@playwright/test/cli.js install --with-deps chromium`]);
  const install = dryRun('hyper-install', { variables: [`TEMPLATE_DIR=${directory}`] });
  const downloads = install.filter((line) => / ci |composer install|install-tools\.mjs/.test(line.replace(/ -- /, ' ')));
  assert.ok(downloads.length > 0, install.join('\n'));
  assert.deepEqual(downloads.filter((line) => !line.includes(ONLINE)), [], 'a download of make hyper-install without $(ONLINE)');
  // An empty template directory makes each dry run print the recipe of the template copy as well.
  const declared = /^CHECK_TARGETS := (.+)$/m.exec(readFileSync('Makefile', 'utf8'))?.[1];
  assert.ok(declared !== undefined, 'the Makefile declares no CHECK_TARGETS');
  const checks = declared.split(' ');
  assert.ok(checks.length > 10, checks.join(' '));
  // kit refuses even a dry run of a target that runs only in CI outside CI, with [ci-only]; CI dry-runs those targets as well.
  const caller = ['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL', 'MAKEOVERRIDES'];
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !caller.includes(name)));
  const ciOnly = (target: string) => {
    const result = spawnSync('make', ['--no-print-directory', '-n', target, `TEMPLATE_DIR=${directory}`], { encoding: 'utf8', env });
    return result.status !== 0 && result.stderr.includes('[ci-only] refuse');
  };
  const checked = [...checks, 'ext'].filter((target) => !ciOnly(target));
  assert.ok(checked.length > 10, checked.join(' '));
  for (const target of checked) {
    const lines = dryRun(target, { variables: [`TEMPLATE_DIR=${directory}`] });
    assert.deepEqual(lines.filter((line) => /env -u/.test(line)), [], `${target} downloads`);
  }
});

test('the venv of the Python server package installs its committed uv.lock and nothing that the index serves now', () => {
  const lines = dryRun('hyper-install-python');
  assert.ok(lines.some((line) => line.endsWith('uv sync --quiet --locked --project packages/server/python')), lines.join('\n'));
  assert.equal(spawnSync('git', ['ls-files', '--error-unmatch', 'packages/server/python/uv.lock'], { encoding: 'utf8' }).status, 0, 'packages/server/python/uv.lock is not tracked');
});
