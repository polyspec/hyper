// Tests the release recipes of the bindings (HR-99, binding GN-19h, CK-94): `make release-recipes` writes
// packages/release.mk with binding release-recipes of the binding generator of package.json, the release runs it before it builds
// an asset, the Makefile includes the file with -include after BINDING_RUN and BINDING_DEP and holds no recipe of its
// own for a target of the file, and Git ignores the file.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dryRun } from './make-dry-run.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAKEFILE = readFileSync(path.join(ROOT, 'Makefile'), 'utf8').split('\n');

// The targets that binding GN-19h writes into packages/release.mk.
const TARGETS = ['install-wasm-bindgen', 'release-assets-npm', 'release-assets-php', 'release-assets-platform', 'release-binding-check', 'release-go-module', 'release-go-static', 'release-npm', 'release-npm-platform', 'release-php-ext', 'release-platform-assets', 'release-wheel'];

const lineOf = (pattern: RegExp) => MAKEFILE.findIndex((line) => pattern.test(line));

test('make release-recipes runs binding release-recipes for the contract (HR-99)', () => {
  const lines = dryRun('release-recipes').join('\n');
  assert.match(lines, /binding\/dist\/cli\.js release-recipes --root \S+ --out \S+/, lines);
});

test('the release writes the recipes before it builds an asset (HR-99)', () => {
  const steps = (MAKEFILE.find((line) => line.startsWith('RELEASE_STEPS :=')) ?? '').split(/\s+/);
  const recipes = steps.indexOf('release-recipes');
  assert.ok(recipes > 0, `RELEASE_STEPS names release-recipes: ${steps.join(' ')}`);
  assert.ok(recipes < steps.indexOf('release-assets'), `release-recipes runs before release-assets: ${steps.join(' ')}`);
});

test('the Makefile includes packages/release.mk with -include after BINDING_RUN and BINDING_DEP (HR-99)', () => {
  const include = lineOf(/^-include \$\(CURDIR\)\/packages\/release\.mk$/);
  assert.ok(include >= 0, 'the Makefile has the line -include $(CURDIR)/packages/release.mk');
  for (const name of ['BINDING_RUN', 'BINDING_DEP']) {
    const definition = lineOf(new RegExp(`^${name} :?=`));
    assert.ok(definition >= 0 && definition < include, `${name} is defined before the include`);
  }
});

test('no rule of the Makefile has a recipe for a target of packages/release.mk (CK-94)', () => {
  const own = TARGETS.filter((target) => MAKEFILE.some((line) => new RegExp(`^${target}:(?!=)`).test(line)));
  assert.deepEqual(own, []);
});

test('Git ignores packages/release.mk (HR-99)', () => {
  const result = spawnSync('git', ['check-ignore', '--quiet', 'packages/release.mk'], { cwd: ROOT });
  assert.equal(result.status, 0, 'git check-ignore packages/release.mk');
});
