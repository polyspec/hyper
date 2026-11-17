// Tests that hyper depends on one template release, 0.0.29 (H21.4, H23.23, H23.25, H23.28, H31.5): the npm packages and
// their locks, the Composer roots and the php-ext package that PIE builds, and the Python package of packages/python name
// that release and no other, and no check or release step reads a template checkout. A mixed version fails here before
// any install runs.
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

// The template release that hyper depends on (H21.4, H23.23). Every pin below names this version.
const VERSION = '0.0.29';
const TAG = `v${VERSION}`;
const RELEASE = `https://github.com/polyspec/template/releases/download/${TAG}`;
// The json release that the platform of the root composer.json declares for ext-polyspec_json.
const JSON_VERSION = jsonString(member(member(json('composer.json'), 'config', 'composer.json'), 'platform', 'composer.json config')['ext-polyspec_json'], 'composer.json platform ext-polyspec_json');
const JSON_PACKAGES = `https://github.com/polyspec/json/releases/download/v${JSON_VERSION}/packages.json`;
const NPM_PACKAGE = '@polyspec/template';
const NPM_PLATFORMS = ['@polyspec/template-darwin-arm64', '@polyspec/template-linux-arm64-gnu', '@polyspec/template-linux-x64-gnu'];
const tarball = (name: string) => `${RELEASE}/${name.slice(1).replace('/', '-')}-${VERSION}.tgz`;

test('the npm manifests name the template tarballs of the release, and their dependencies name its version (H21.4)', () => {
  const root = json('package.json');
  assert.equal(member(root, 'dependencies', 'package.json')[NPM_PACKAGE], tarball(NPM_PACKAGE), `package.json dependencies ${NPM_PACKAGE}`);
  for (const name of NPM_PLATFORMS) assert.equal(member(root, 'optionalDependencies', 'package.json')[name], tarball(name), `package.json optionalDependencies ${name}`);
  // npm resolves the exact version that a workspace requires to the tarball that the root names (H35.8-2), so a manifest
  // that names a tarball holds no `overrides`, which would state the pin a second time.
  for (const manifest of ['package.json', 'tests/package-install/package.json']) {
    assert.equal(json(manifest).overrides, undefined, `${manifest} holds no overrides`);
  }
  for (const manifest of ['packages/client/package.json', 'packages/ts/package.json', 'packages/cli/package.json']) {
    assert.equal(optionalMember(json(manifest), 'dependencies', manifest)[NPM_PACKAGE], VERSION, `${manifest} ${NPM_PACKAGE}`);
  }
  const installed = optionalMember(json('tests/package-install/package.json'), 'dependencies', 'tests/package-install/package.json');
  assert.equal(installed[NPM_PACKAGE], tarball(NPM_PACKAGE), `tests/package-install/package.json ${NPM_PACKAGE}`);
});

test('the npm locks record the template tarballs of the release (H21.4)', () => {
  for (const lock of ['package-lock.json', 'tests/package-install/package-lock.json']) {
    const packages = member(json(lock), 'packages', lock);
    for (const name of [NPM_PACKAGE, ...NPM_PLATFORMS]) {
      const value = packages[`node_modules/${name}`];
      if (value === undefined) continue;
      const entry = jsonObject(value, `${lock} node_modules/${name}`);
      assert.equal(entry.version, VERSION, `${lock} ${name} version`);
      assert.equal(entry.resolved, tarball(name), `${lock} ${name} resolved`);
    }
  }
  const root = member(json('package-lock.json'), 'packages', 'package-lock.json');
  for (const name of [NPM_PACKAGE, ...NPM_PLATFORMS]) assert.ok(root[`node_modules/${name}`], `the root lock pins ${name}`);
});

test('the Composer roots name the Composer repository of the release and declare the extension at its version (H21.4, H23.11, H27.45)', () => {
  for (const manifest of ['composer.json', 'examples/board/composer.json', 'packages/php/composer.json']) {
    const platform = member(member(json(manifest), 'config', manifest), 'platform', `${manifest} config`);
    assert.equal(platform['ext-polyspec_template'], VERSION, `${manifest} platform ext-polyspec_template`);
  }
  for (const manifest of ['composer.json', 'examples/board/composer.json']) {
    const urls = jsonObjects(json(manifest).repositories, `${manifest} repositories`).filter(({ type }) => type === 'composer').map(({ url }) => url);
    // Beside the template release, each root declares the Composer repository of the json release (HY-48.15).
    assert.deepEqual(urls, [`${RELEASE}/packages.json`, JSON_PACKAGES], `${manifest} Composer repository`);
  }
});

test('make template-ext builds the php-ext package of the release from its Composer repository (H21.4, H27.45, H27.51)', () => {
  const lines = dryRun('template-ext');
  // PIE adds the verified copy of the Composer repository of the release and builds the package at its version (H27.51, H35.54).
  assert.ok(lines.some((line) => / repository:add composer \S+\/var\/pie\/polyspec\/template\/repository\/polyspec\/template\/packages\.json --no-interaction && \\$/.test(line)), lines.join('\n'));
  assert.ok(lines.some((line) => line.endsWith(` build polyspec/template:${VERSION} --no-interaction && \\`)), lines.join('\n'));
});

test('the Python package of the server names the wheel assets of the release with their sha256 (H21.4, H23.5)', () => {
  const pyproject = read('packages/python/pyproject.toml');
  const requirements = [...pyproject.matchAll(/"(polyspec-template @ [^"]*)"/g)].map((match) => {
    const requirement = match[1];
    if (requirement === undefined) throw new Error(`${match[0]} has no requirement`);
    return requirement.replace(/#sha256=[0-9a-f]{64} ;.*$/, '#sha256=<hex>');
  });
  assert.deepEqual(
    requirements,
    ['macosx_11_0_arm64', 'manylinux_2_34_aarch64', 'manylinux_2_34_x86_64'].map((tag) => `polyspec-template @ ${RELEASE}/polyspec_template-${VERSION}-cp314-abi3-${tag}.whl#sha256=<hex>`),
    'pyproject.toml names the template wheels of the release assets and the sha256 of each asset',
  );
});
