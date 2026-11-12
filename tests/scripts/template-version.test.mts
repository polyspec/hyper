// Tests that hyper depends on one template release, 0.0.27 (H21.4, H23.23, H23.25, H23.28): the npm packages and their
// locks, the Composer packages and their locks, the php-ext package that PIE builds and the Python package of
// packages/server/python name that release and no other, and no check or release step reads a template checkout. A mixed
// version fails here before any install runs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { type JsonObject, jsonObject, jsonObjects, jsonString, parseJsonObject } from '../../scripts/json.mts';
import { dryRun } from './make-dry-run.mts';

const repository = resolve('.');
const read = (file: string) => readFileSync(join(repository, file), 'utf8');
const json = (file: string): JsonObject => parseJsonObject(read(file), file);
// The object `key` of `object`; an absent key fails.
const member = (object: JsonObject, key: string, where: string): JsonObject => jsonObject(object[key], `${where} ${key}`);
// The object `key` of `object`, or an empty object when the manifest declares none, as `dependencies` of a package.
const optionalMember = (object: JsonObject, key: string, where: string): JsonObject => (object[key] === undefined ? {} : member(object, key, where));
// The entry of the package `name` of the `packages` list of a Composer lock.
const composerPackage = (lock: string, name: string): JsonObject | undefined => jsonObjects(json(lock).packages, `${lock} packages`).find((entry) => entry.name === name);

// The template release that hyper depends on (H21.4, H23.23). Every pin below names this version.
const VERSION = '0.0.27';
const TAG = `v${VERSION}`;
const RELEASE = `https://github.com/polyspec/template/releases/download/${TAG}`;
const NPM_PACKAGES = ['@polyspec/template', '@polyspec/template-compiler'];

test('the npm manifests name the template tarballs of the release, and their dependencies name its version (H21.4)', () => {
  const root = json('package.json');
  for (const name of NPM_PACKAGES) {
    const tarball = `${RELEASE}/${name.slice(1).replace('/', '-')}-${VERSION}.tgz`;
    assert.equal(member(root, 'dependencies', 'package.json')[name], tarball, `package.json dependencies ${name}`);
    assert.equal(member(root, 'overrides', 'package.json')[name], `$${name}`, `package.json overrides ${name} through its direct dependency`);
  }
  for (const manifest of ['packages/client/package.json', 'packages/server/ts/package.json', 'packages/build/package.json']) {
    const dependencies = optionalMember(json(manifest), 'dependencies', manifest);
    for (const name of NPM_PACKAGES.filter((name) => name in dependencies)) assert.equal(dependencies[name], VERSION, `${manifest} ${name}`);
  }
  const installed = optionalMember(json('tests/package-install/package.json'), 'dependencies', 'tests/package-install/package.json');
  assert.ok(NPM_PACKAGES.some((name) => name in installed), 'tests/package-install installs a template package');
  for (const name of NPM_PACKAGES.filter((name) => name in installed)) {
    assert.equal(installed[name], `${RELEASE}/${name.slice(1).replace('/', '-')}-${VERSION}.tgz`, `tests/package-install/package.json ${name}`);
  }
});

test('the npm locks record the template tarballs of the release (H21.4)', () => {
  for (const lock of ['package-lock.json', 'tests/package-install/package-lock.json']) {
    const packages = member(json(lock), 'packages', lock);
    for (const name of NPM_PACKAGES) {
      const value = packages[`node_modules/${name}`];
      if (value === undefined) continue;
      const entry = jsonObject(value, `${lock} node_modules/${name}`);
      assert.equal(entry.version, VERSION, `${lock} ${name} version`);
      assert.equal(entry.resolved, `${RELEASE}/${name.slice(1).replace('/', '-')}-${VERSION}.tgz`, `${lock} ${name} resolved`);
    }
  }
  assert.ok(member(json('package-lock.json'), 'packages', 'package-lock.json')['node_modules/@polyspec/template'], 'the root lock pins @polyspec/template');
});

test('the Composer manifests name the Composer repository of the release and their locks its template zip (H21.4, H23.11, H27.45)', () => {
  const manifests = ['composer.json', 'examples/board/composer.json'];
  for (const manifest of manifests) {
    const require = member(json(manifest), 'require', manifest);
    if (require['polyspec/template']) assert.equal(require['polyspec/template'], VERSION, `${manifest} require`);
    const urls = jsonObjects(json(manifest).repositories, `${manifest} repositories`).filter(({ type }) => type === 'composer').map(({ url }) => url);
    assert.deepEqual(urls, [`${RELEASE}/packages.json`], `${manifest} Composer repository`);
  }
  for (const lock of ['composer.lock', 'examples/board/composer.lock']) {
    const entry = composerPackage(lock, 'polyspec/template');
    assert.ok(entry, `${lock} locks polyspec/template`);
    assert.equal(entry.version, VERSION, `${lock} version`);
    assert.equal(jsonString(member(entry, 'dist', lock).url, `${lock} dist url`), `${RELEASE}/polyspec-template-php-${VERSION}.zip`, `${lock} dist url`);
  }
});

test('make template-ext builds the php-ext package of the release from its Composer repository (H21.4, H27.45, H27.51)', () => {
  const lines = dryRun('template-ext');
  // PIE adds the Composer repository of the release and builds the package at its version (H27.51).
  assert.ok(lines.some((line) => line.endsWith(` repository:add composer ${RELEASE}/packages.json --no-interaction`)), lines.join('\n'));
  assert.ok(lines.some((line) => line.endsWith(` build polyspec/template-php-ext:${VERSION} --no-interaction`)), lines.join('\n'));
});

test('the Python package of the server names the wheel asset of the release with its sha256 (H21.4, H23.5)', () => {
  const pyproject = read('packages/server/python/pyproject.toml');
  const requirements = [...pyproject.matchAll(/"(polyspec-template @ [^"]*)"/g)].map((match) => {
    const requirement = match[1];
    if (requirement === undefined) throw new Error(`${match[0]} has no requirement`);
    return requirement;
  });
  assert.deepEqual(
    requirements.map((requirement) => requirement.replace(/#sha256=[0-9a-f]{64}$/, '#sha256=<hex>')),
    [`polyspec-template @ ${RELEASE}/polyspec_template-${VERSION}-py3-none-any.whl#sha256=<hex>`],
    'pyproject.toml names the template wheel of the release asset and the sha256 of that asset',
  );
});
