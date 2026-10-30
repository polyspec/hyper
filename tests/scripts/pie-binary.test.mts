// Tests scripts/pie-binary.mts (H27.51): it prints the one library that PIE recorded for a package as the pie-built-binary
// of its entry in <work>/<target>/vendor/composer/installed.json, and fails unless exactly one entry of that name carries one.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NAME = 'polyspec/template-php-ext';

function work(t: TestContext): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-pie-binary-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// Writes the installed.json of the PIE target `target` under `root` with `packages`.
function installed(root: string, target: string, packages: unknown[]): string {
  const composer = path.join(root, target, 'vendor', 'composer');
  mkdirSync(composer, { recursive: true });
  writeFileSync(path.join(composer, 'installed.json'), JSON.stringify({ packages }));
  return composer;
}

const entry = (name: string, binary?: string) => ({ name, 'install-path': `../${name}`, extra: binary === undefined ? {} : { 'pie-built-binary': binary } });

function pieBinary(root: string, name = NAME) {
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts/pie-binary.mts'), root, name], { encoding: 'utf8' });
}

test('pie-binary prints the pie-built-binary of the one entry of the package, resolved against vendor/composer (H27.51)', (t) => {
  const root = work(t);
  const composer = installed(root, 'php_8.4-abc', [entry('polyspec/template', undefined), entry('other/ext', '../other/modules/other.so'), entry(NAME, `../${NAME}/modules/polyspec_template.so`)]);
  const result = pieBinary(root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${path.resolve(composer, `../${NAME}/modules/polyspec_template.so`)}\n`);
});

test('pie-binary fails when no entry of the package carries a pie-built-binary (H27.51)', (t) => {
  const root = work(t);
  installed(root, 'php_8.4-abc', [entry(NAME), entry('other/ext', '../other/modules/other.so')]);
  const result = pieBinary(root);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /0 builds of polyspec\/template-php-ext/);
});

test('pie-binary fails when two targets recorded a build of the package (H27.51)', (t) => {
  const root = work(t);
  installed(root, 'php_8.3-abc', [entry(NAME, `../${NAME}/modules/polyspec_template.so`)]);
  installed(root, 'php_8.4-def', [entry(NAME, `../${NAME}/modules/polyspec_template.so`)]);
  const result = pieBinary(root);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /2 builds of polyspec\/template-php-ext/);
});

test('pie-binary refuses a name that is not a Composer package name and a missing argument (H27.51)', (t) => {
  const root = work(t);
  assert.equal(pieBinary(root, 'template-php-ext').status, 1);
  const missing = spawnSync(process.execPath, [path.join(ROOT, 'scripts/pie-binary.mts'), root], { encoding: 'utf8' });
  assert.equal(missing.status, 2);
});
