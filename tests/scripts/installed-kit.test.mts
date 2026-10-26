// HR-70, HR-81: a fresh checkout bootstraps native npm before reading installed shared tools, without a sibling kit.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
import { jsonString, parseJsonObject } from '../../scripts/json.mts';

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
  const result = spawnSync(resolve('var/tools/bin/npm'), ['ci', '--offline', '--ignore-scripts', '--no-audit'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `make install-packages prepares the native package cache:\n${result.stdout}${result.stderr}`);
  const manifest = parseJsonObject(readFileSync(join(root, 'node_modules/@polyspec/kit/package.json'), 'utf8'), 'installed kit package.json');
  assert.equal(jsonString(manifest.name, 'installed package name'), '@polyspec/kit');
  const run = spawnSync('make', ['--no-print-directory', '-n', 'kit-check', `NODE=${process.execPath}`], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /node_modules\/@polyspec\/kit\/dist\/kit-check\.mjs/);
  assert.doesNotMatch(run.stdout, /\.\.\/kit/);
});
