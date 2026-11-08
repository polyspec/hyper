// Tests how the recipes of the Makefile use the toolchain (HR-81, HR-89): make hyper-install installs the tools of the
// checkout, npm and Composer of the checkout are started by the absolute paths of its var/tools, every recipe runs npm
// and Composer offline, only the install targets download, and the package manager installs hold the install lock. A
// tool that is missing fails the target that runs it (kit K854). The tools themselves (install-tools of @polyspec/kit)
// are tested in kit.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { kitTool } from './kit-tools.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// kit deletes the tools that it no longer ships, as the toolchain check and the install wrappers of kit 0.0.77 (K854, K859),
// so a recipe that still started one would fail when it runs.
test('every tool of kit that a recipe of the Makefile starts is a tool of the installed kit', () => {
  const tools = [...readFileSync(path.join(ROOT, 'Makefile'), 'utf8').matchAll(/\$\(KIT\)\/([\w-]+)\.\$\(KIT_EXT\)/g)].map((match) => match[1] ?? '');
  assert.ok(tools.length > 0, 'the Makefile starts no tool of kit');
  assert.deepEqual([...new Set(tools)].filter((tool) => !existsSync(kitTool(tool))), []);
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

// The settings that keep npm and Composer from reading the network, and the prefix of the downloads that lift
// them (HR-89).
const OFFLINE = { npm_config_offline: 'true', COMPOSER_DISABLE_NETWORK: '1' };

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
