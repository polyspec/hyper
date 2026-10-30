// Tests how the recipes of the Makefile use the toolchain (HR-81, HR-89): make hyper-install installs the tools of the
// checkout, npm and Composer of the checkout are started by the absolute paths of its var/tools, every recipe runs npm
// and Composer offline, only the install targets download, and the package manager installs hold the install lock. A
// tool that is missing fails the target that runs it (kit K854). The tools themselves (install-tools of @polyspec/kit)
// are tested in kit.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { dryRun } from './make-dry-run.mts';
import { kitTool } from './kit-tools.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// The tools of the checkout: every checkout, a linked worktree too, installs and runs its own var/tools (kit K858).
const TOOLS = path.join(realpathSync(ROOT), 'var/tools');
const NPM = path.join(TOOLS, 'bin/npm');
// The node of mise.toml, which the bootstrap wraps in var/tools/bin and kit.mk names $(NODE) (kit K171).
const NODE = path.join(TOOLS, 'bin/node');
// Composer is a tool of mise.toml, run by its shim (kit K127).
const COMPOSER = path.join(TOOLS, 'mise/shims/composer');
// The commands of recipe lines: a command that a lock runs follows its --, and the variable assignments before a command, as
// COMPOSER=composer.local.json of make composer-development, are its environment, not the command.
const commandsOf = (lines: string[]) => lines.flatMap((line) => line.split(/&&|;|\|\||\s--\s/).map((part) => part.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '')));

// make hyper-install of every checkout installs its own tools (kit K858).
test('make hyper-install installs the tools of the checkout', () => {
  const lines = dryRun('hyper-install').map((line) => line.trim());
  assert.ok(lines.includes(`env -u npm_config_offline -u COMPOSER_DISABLE_NETWORK ${NODE} ${kitTool('install-tools')}`), lines.join('\n'));
});

// kit deletes the tools that it no longer ships, as the toolchain check and the install wrappers of kit 0.0.77 (K854, K859),
// so a recipe that still started one would fail when it runs.
test('every tool of kit that a recipe of the Makefile starts is a tool of the installed kit', () => {
  const tools = [...readFileSync(path.join(ROOT, 'Makefile'), 'utf8').matchAll(/\$\(KIT\)\/([\w-]+)\.\$\(KIT_EXT\)/g)].map((match) => match[1] ?? '');
  assert.ok(tools.length > 0, 'the Makefile starts no tool of kit');
  assert.deepEqual([...new Set(tools)].filter((tool) => !existsSync(kitTool(tool))), []);
});

test('the package manager installs of make hyper-install run under the install lock', () => {
  const lines = dryRun('hyper-install');
  const installs = lines.filter((line) => / ci | install( |$)/.test(line) && /(npm|composer) /.test(line));
  assert.equal(installs.length, 2, lines.join('\n'));
  assert.deepEqual(installs.filter((line) => !line.includes(`${NODE} ${kitTool('holder-lock')} run var/install.lock -- `)), []);
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

test('every recipe starts npm and Composer by the absolute paths of var/tools/bin and of the shims of mise', () => {
  const targets = ['hyper-install', 'ext', 'packages', 'hyper-server-php-install', 'package-check', 'hyper-test-scripts', 'hyper-test-node', 'hyper-test-php', 'hyper-lint', 'analyse-php', 'parity', 'server-parity', 'e2e', 'bundle-size'];
  const lines = [];
  for (const target of targets) lines.push(...dryRun(target));
  const commands = commandsOf(lines);
  const tools = commands.filter((command) => /^(\S*\/)?(npm|npx|composer)( |$)/.test(command));
  assert.ok(tools.some((command) => command.startsWith(`${NPM} `)) && tools.some((command) => command.startsWith(`${COMPOSER} `)), lines.join('\n'));
  assert.deepEqual(tools.filter((command) => !command.startsWith(`${NPM} `) && !command.startsWith(`${COMPOSER} `)), []);
});

test('no recipe queries a registry: installs follow their lock without an audit, and the package install test installs offline (HR-89)', () => {
  const targets = ['hyper-install', 'ext', 'packages', 'hyper-server-php-install', 'package-check', 'hyper-test-scripts', 'hyper-test-js', 'hyper-test-node', 'hyper-test-php', 'hyper-lint', 'analyse-php', 'parity', 'server-parity', 'e2e', 'bundle-size', 'templates-check', 'docs-check'];
  const lines = targets.flatMap((target) => dryRun(target));
  const commands = commandsOf(lines);
  const npm = commands.filter((command) => command.startsWith(`${NPM} `));
  assert.ok(npm.length > 0, lines.join('\n'));
  assert.deepEqual(npm.filter((command) => !/^\S+ (ci|run) /.test(command)), [], 'an npm command other than ci or run');
  assert.deepEqual(npm.filter((command) => / ci /.test(command) && !command.includes('--no-audit')), []);
  // Native installation inherits the offline recipe environment, verified below.
  const consumer = dryRun('package-check').filter((line) => line.startsWith('cd tests/package-install && ') && line.includes(`${NPM} ci `));
  assert.equal(consumer.length, 1, 'the package check installs the lock of tests/package-install with npm ci');
  const install = consumer[0];
  assert.ok(install !== undefined, 'the package consumer install is present');
  assert.ok(install.includes('tests/package-install'), install);
  assert.ok(!install.includes('env -u'), 'the consumer must retain the offline environment');
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

test('only explicit install targets download through $(ONLINE), and no check target downloads (HR-89)', () => {
  // Every checkout downloads its own tools (kit K858).
  assert.deepEqual(dryRun('install-tools').map((line) => line.trim()), [`${ONLINE}${NODE} ${kitTool('install-tools')}`]);
  assert.deepEqual(dryRun('install-packages'), [`${ONLINE}${NPM} ci`]);
  assert.deepEqual(dryRun('hyper-install-browser'), [`${ONLINE}${NODE} node_modules/@playwright/test/cli.js install --with-deps chromium`]);
  const image = /^VIRTIOFS_IMAGE := (\S+)$/m.exec(readFileSync('Makefile', 'utf8'))?.[1];
  assert.ok(image);
  assert.match(image, /@sha256:[a-f0-9]{64}$/);
  assert.deepEqual(dryRun('hyper-install-virtiofs'), [`${ONLINE}container image pull --platform linux/arm64 ${image}`]);
  const install = dryRun('hyper-install');
  const downloads = install.filter((line) => / ci |composer install|install-tools\.mts/.test(line.replace(/ -- /, ' ')));
  assert.ok(downloads.length > 0, install.join('\n'));
  assert.deepEqual(downloads.filter((line) => !line.includes(ONLINE)), [], 'a download of make hyper-install without $(ONLINE)');
  const declared = /^CHECK_TARGETS := (.+)$/m.exec(readFileSync('Makefile', 'utf8'))?.[1];
  assert.ok(declared !== undefined, 'the Makefile declares no CHECK_TARGETS');
  const checks = declared.split(' ');
  assert.ok(checks.length > 10, checks.join(' '));
  // kit refuses even a dry run of a target that runs only in CI outside CI, with [ci-only]; CI dry-runs those targets as well.
  const caller = ['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL', 'MAKEOVERRIDES'];
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !caller.includes(name)));
  const ciOnly = (target: string) => {
    const result = spawnSync('make', ['--no-print-directory', '-n', target], { encoding: 'utf8', env });
    return result.status !== 0 && result.stderr.includes('[ci-only] refuse');
  };
  const checked = [...checks, 'ext'].filter((target) => !ciOnly(target));
  assert.ok(checked.length > 10, checked.join(' '));
  for (const target of checked) {
    const lines = dryRun(target);
    assert.deepEqual(lines.filter((line) => /env -u/.test(line)), [], `${target} downloads`);
  }
});

// H27.39: the venv is made anew, so uv writes no file through a link of the venv that it replaces, and the package is installed
// non-editable, since the python extractor of kit reads the modules of the installed distribution (kit K788).
test('the venv of the Python server package installs its committed uv.lock and nothing that the index serves now', () => {
  const lines = dryRun('hyper-install-python');
  const removed = lines.findIndex((line) => line === `rm -rf ${path.join(ROOT, 'packages/server/python/.venv')}`);
  const made = lines.findIndex((line) => line.includes('python-venv DIR='));
  assert.ok(removed !== -1 && made > removed, lines.join('\n'));
  // uv-install of kit runs uv sync --locked with the flags of SYNC (kit K850).
  assert.ok(lines.some((line) => line.startsWith('UV_SYNC="--quiet --no-editable --project packages/server/python" ') && line.endsWith(`${kitTool('uv-install')} .`)), lines.join('\n'));
  assert.equal(spawnSync('git', ['ls-files', '--error-unmatch', 'packages/server/python/uv.lock'], { encoding: 'utf8' }).status, 0, 'packages/server/python/uv.lock is not tracked');
});


test('H27.25 language installs run only their own package manager (HR-81, HR-89)', () => {
  const php = dryRun('hyper-install-php').join('\n');
  assert.match(php, /composer install --no-interaction/);
  assert.doesNotMatch(php, /uv sync|python-venv|install-tools\.(?:mts|mjs)|npm ci/);
  const python = dryRun('hyper-install-python').join('\n');
  assert.match(python, /uv-install\.(?:mts|mjs) \.$/m);
  assert.doesNotMatch(python, /composer install|release-assets\.(?:mts|mjs)|install-tools\.(?:mts|mjs)/);
});
