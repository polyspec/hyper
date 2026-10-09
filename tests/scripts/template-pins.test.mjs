// Tests the template pins of this repository (HY-70, HY-80, H14.1-7): `make template-tag` fails for a template checkout
// without the tag TEMPLATE_TAG, which the full-run key names; npm installs the template package as one copy inside the
// checkout; Composer installs the template PHP package from the zip of the template release; and PHPStan reads the stub
// of the unpacked php-ext asset (scripts/template-ext.mjs), not a copy of the template repository.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { requireBuilt } from './requires.mjs';

const repository = resolve('.');
// The tag TEMPLATE_TAG of the Makefile, the one declaration of the template release (HY-80).
const TAG = /^TEMPLATE_TAG := (\S+)$/m.exec(readFileSync(join(repository, 'Makefile'), 'utf8'))[1];

// A template repository with a tracked file, and the tag TAG at its commit unless `tagged` is false.
function templateRepository(t, tagged = true) {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-template-repository-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const files = {
    'packages/template-ts/package.json': JSON.stringify({ name: '@polyspec/template', version: '0.0.1' }),
    'packages/template-php/composer.json': '{"name": "polyspec/template"}\n',
    'packages/template-php-ext/src/polyspec_template.stub.php': '<?php\n',
    'package-lock.json': '{}\n',
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), text);
  }
  const git = (...args) => execFileSync('git', ['-c', 'user.name=hyper', '-c', 'user.email=hyper@localhost', '-C', directory, ...args], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  if (tagged) git('tag', TAG);
  return { directory };
}

test('make template-tag fails for a template checkout without the tag TEMPLATE_TAG and passes with it', (t) => {
  const make = (template) => spawnSync('make', ['--no-print-directory', 'template-tag', `TEMPLATE_REPOSITORY=${template.directory}`], {
    cwd: repository, encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL', 'MAKEOVERRIDES'].includes(name))),
  });
  const untagged = templateRepository(t, false);
  const missing = make(untagged);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, new RegExp(`template-tag: \\S+ has no tag ${TAG.replaceAll('.', '\\.')}: expected the tag ${TAG.replaceAll('.', '\\.')}, actual tags: \\n`));
  const tagged = templateRepository(t);
  const found = make(tagged);
  assert.equal(found.status, 0, found.stderr);
});

test('npm installs the template package as one copy inside this checkout', () => {
  requireBuilt('install', 'node_modules/@polyspec/template/package.json');
  const path = 'node_modules/@polyspec/template';
  assert.equal(lstatSync(join(repository, path)).isSymbolicLink(), false, path);
  assert.equal(lstatSync(join(repository, path)).isDirectory(), true, path);
  assert.ok(realpathSync(join(repository, path)).startsWith(`${repository}/`), path);
  // The packages of the workspace resolve the root package through the overrides, so they hold no copy of their own.
  for (const nested of ['packages/hyper-client/node_modules/@polyspec/template', 'packages/hyper-server-node/node_modules/@polyspec/template']) {
    assert.equal(existsSync(join(repository, nested)), false, nested);
  }
});

test('Composer installs the template PHP package from the zip of the template release, and PHPStan reads the stub of the unpacked php-ext asset', () => {
  const version = JSON.parse(readFileSync('packages/hyper-server-php/composer.json', 'utf8')).require['polyspec/template'];
  assert.match(version, /^\d+\.\d+\.\d+$/, 'packages/hyper-server-php requires an exact template version');
  for (const manifest of ['composer.json', 'examples/board/composer.json']) {
    const { repositories, require } = JSON.parse(readFileSync(manifest, 'utf8'));
    assert.equal(require['polyspec/template'], version, manifest);
    assert.deepEqual(repositories.filter((item) => String(item.url).includes('var/products/template')), [], manifest);
    const packages = repositories.filter((item) => item.type === 'package' && item.package.name === 'polyspec/template');
    assert.equal(packages.length, 1, manifest);
    assert.equal(packages[0].package.version, version, manifest);
    assert.deepEqual({ ...packages[0].package.dist, shasum: undefined }, { type: 'zip', url: `https://github.com/polyspec/template/releases/download/v${version}/polyspec-template-php-${version}.zip`, shasum: undefined }, manifest);
    assert.match(packages[0].package.dist.shasum, /^[0-9a-f]{40}$/, `${manifest}: the zip is pinned by its shasum`);
    const lock = JSON.parse(readFileSync(manifest.replace(/\.json$/, '.lock'), 'utf8'));
    assert.deepEqual(lock.packages.find(({ name }) => name === 'polyspec/template').dist, packages[0].package.dist, manifest);
  }
  const scanned = /scanFiles:\n\s+- (\S+)/.exec(readFileSync('packages/hyper-server-php/phpstan.neon', 'utf8'))[1];
  assert.equal(resolve('packages/hyper-server-php', scanned), join(repository, 'var/products/template-ext/src/polyspec_template.stub.php'));
});
