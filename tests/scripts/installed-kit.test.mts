// HR-70, HR-81: a fresh checkout bootstraps native npm before reading installed shared tools, without a sibling kit.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { jsonString, parseJsonObject } from '../../scripts/json.mts';
import { checkoutTools } from './checkout-tools.mts';

function checkout(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-installed-kit-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, 'checkout');
  mkdirSync(root);
  for (const file of ['Makefile', 'package.json', 'package-lock.json', '.npmrc', 'packages/client/package.json', 'packages/server/ts/package.json', 'packages/build/package.json']) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    cpSync(file, join(root, file));
  }
  assert.equal(existsSync(join(directory, 'kit')), false);
  return root;
}

test('a fresh checkout can bootstrap the declared native npm without installed tools or a sibling', (t) => {
  const root = checkout(t);
  const result = spawnSync('make', ['--no-print-directory', '-n', 'bootstrap'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\/npm" exec --yes --package=/);
  assert.match(result.stdout, /packageManager/);
  assert.match(result.stdout, /npm ci --ignore-scripts --allow-remote=root/);
  assert.doesNotMatch(result.stdout, /\.\.\/kit/);
});

test('a native locked archive install reads the installed bootstrap with no sibling checkout', { timeout: 120000 }, (t) => {
  const root = checkout(t);
  const result = spawnSync(join(checkoutTools(), 'bin/npm'), ['ci', '--offline', '--ignore-scripts', '--no-audit'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `make install-packages prepares the native package cache:\n${result.stdout}${result.stderr}`);
  const manifest = parseJsonObject(readFileSync(join(root, 'node_modules/@polyspec/kit/package.json'), 'utf8'), 'installed kit package.json');
  assert.equal(jsonString(manifest.name, 'installed package name'), '@polyspec/kit');
  const run = spawnSync('make', ['--no-print-directory', '-n', 'kit-check', `NODE=${process.execPath}`], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /node_modules\/@polyspec\/kit\/dist\/kit-check\.mjs/);
  assert.doesNotMatch(run.stdout, /\.\.\/kit/);
  const modules = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import { pathToFileURL } from 'node:url';
    const entry = pathToFileURL(createRequire(process.cwd() + '/package.json').resolve('@polyspec/kit/run-tests'));
    const declaration = await import(new URL('./parity-declaration.mjs', entry));
    const symbols = await import(new URL('./parity-symbols.mjs', entry));
    const units = await import(new URL('./parity-units.mjs', entry));
    assert.equal(typeof declaration.readDeclaration, 'function');
    assert.equal(typeof symbols.extractSymbols, 'function');
    assert.equal(typeof units.undeclaredPublic, 'function');
  `], { cwd: root, encoding: 'utf8' });
  assert.equal(modules.status, 0, `${modules.stdout}${modules.stderr}`);
});


test('H27.15-1 explicit bootstrap enables downloads under an inherited offline setting', (t) => {
  const root = checkout(t);
  const npm = join(root, 'bootstrap-npm.mjs');
  const report = join(root, 'bootstrap-call.json');
  writeFileSync(npm, `#!${process.execPath}\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(report)}, JSON.stringify({ offline: process.env.npm_config_offline, args: process.argv.slice(2) }));\n`);
  chmodSync(npm, 0o755);
  const result = spawnSync('make', ['--no-print-directory', 'bootstrap', `BOOTSTRAP_NPM=${npm}`], { cwd: root, encoding: 'utf8', env: { ...process.env, npm_config_offline: 'true' } });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  const call = parseJsonObject(readFileSync(report, 'utf8'), 'bootstrap invocation');
  assert.equal(call.offline, 'false', 'explicit installation must permit its declared downloads');
  assert.ok(Array.isArray(call.args) && call.args.includes('ci'), 'bootstrap must retain the native locked install');
});


// H27.21, kit K859: the consumer of make package-check installs its own lock with npm ci, as its recipe does, since kit
// ships no install wrapper of npm; make link connects the checkouts of .links afterwards.
test('H27.21 the native consumer installs its lock with npm ci offline without editor tools', { timeout: 120000 }, (t) => {
  const root = checkout(t);
  const npm = join(checkoutTools(), 'bin/npm');
  const env = { ...process.env, npm_config_offline: 'true' };
  const installed = spawnSync(npm, ['ci', '--offline', '--ignore-scripts', '--no-audit'], { cwd: root, encoding: 'utf8', env });
  assert.equal(installed.status, 0, `${installed.stdout}${installed.stderr}`);
  const project = join(root, 'tests/package-install');
  mkdirSync(project, { recursive: true });
  for (const file of ['package.json', 'package-lock.json']) cpSync(join('tests/package-install', file), join(project, file));
  const lock = readFileSync(join(project, 'package-lock.json'), 'utf8');
  const consumer = spawnSync(npm, ['ci', '--no-audit', '--allow-remote=root'], { cwd: project, encoding: 'utf8', env });
  assert.equal(consumer.status, 0, `${consumer.stdout}${consumer.stderr}`);
  assert.equal(realpathSync(join(project, 'node_modules/@polyspec/hyper-client')), realpathSync(join(root, 'packages/client')));
  const template = parseJsonObject(readFileSync(join(project, 'node_modules/@polyspec/template/package.json'), 'utf8'), 'installed template package.json');
  assert.equal(jsonString(template.name, 'installed template name'), '@polyspec/template');
  assert.equal(readFileSync(join(project, 'package-lock.json'), 'utf8'), lock);
  // H27.48-1, kit K916: with no .links, as in CI, make link of the installed kit links nothing and writes no Claude Code hook,
  // whose node an installed kit lacks. link reads the checkout from git, so the copy is a work tree, as the CI checkout is.
  cpSync('.gitignore', join(root, '.gitignore'));
  for (const args of [['init', '--quiet'], ['add', '--all']]) assert.equal(spawnSync('git', args, { cwd: root, encoding: 'utf8' }).status, 0);
  const linked = spawnSync('make', ['--no-print-directory', 'link', 'PROJECT=tests/package-install', `NODE=${process.execPath}`], { cwd: root, encoding: 'utf8', env });
  assert.equal(linked.status, 0, `${linked.stdout}${linked.stderr}`);
  assert.equal(realpathSync(join(project, 'node_modules/@polyspec/hyper-client')), realpathSync(join(root, 'packages/client')));
  assert.equal(existsSync(join(project, '.claude/settings.local.json')), false);
});
