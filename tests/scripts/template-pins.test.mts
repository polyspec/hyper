// Tests the template pins of this repository (HR-70, HR-80, H14.1-7, H27.57): every install verifies each template asset
// that it installs by its integrity. Each manifest names the template release by its version or the URL of its asset, and
// each lock pins that asset by its integrity: the sha512 of the npm locks, the sha1 of the Composer locks and the sha256 of
// the Python wheel in pyproject.toml and uv.lock. Workspaces resolve the same installed template package, including a
// source link, and PHPStan reads the PHP library without an extension stub.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { jsonObject, jsonObjects, jsonString, parseJsonObject } from '../../scripts/json.mts';
import { requireBuilt } from './requires.mts';

const repository = resolve('.');
// The JSON object of the file `file`.
const readObject = (file: string) => parseJsonObject(readFileSync(file, 'utf8'), file);
// The template release: the exact version that the private root composer.json requires; every pin below names it.
const VERSION = jsonString(jsonObject(readObject('composer.json').require, 'composer.json require')['polyspec/template'], 'composer.json require polyspec/template');
const RELEASE = `https://github.com/polyspec/template/releases/download/v${VERSION}`;
const NPM_PACKAGES = ['@polyspec/template', '@polyspec/template-compiler'];
// The tarball asset of the npm package `name` of the release.
const tarball = (name: string) => `${RELEASE}/${name.slice(1).replace('/', '-')}-${VERSION}.tgz`;
const WHEEL = `${RELEASE}/polyspec_template-${VERSION}-py3-none-any.whl`;

test('the template release is one exact version', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/, 'composer.json requires an exact template version');
});

test('workspaces resolve the same installed template package through native source links or an installation', () => {
  requireBuilt('hyper-install', 'node_modules/@polyspec/template/package.json');
  assert.equal(readObject('node_modules/@polyspec/template/package.json').name, '@polyspec/template');
  const render = createRequire(join(repository, 'package.json')).resolve('@polyspec/template/render');
  for (const workspace of ['packages/client', 'packages/server/ts', 'packages/build']) {
    assert.equal(createRequire(join(repository, workspace, 'package.json')).resolve('@polyspec/template/render'), render, workspace);
  }
});

test('the npm manifests name the tarball assets of the release and their locks pin them by integrity', () => {
  // One asset has one sha512: npm keeps the integrity of a lock entry when only its URL changes, and an offline install
  // finds no cached tarball for a stale one (H27.63).
  const integrities = new Map<string, string>();
  for (const [manifest, lock] of [['package.json', 'package-lock.json'], ['tests/package-install/package.json', 'tests/package-install/package-lock.json']] as const) {
    const dependencies = jsonObject(readObject(manifest).dependencies, `${manifest} dependencies`);
    const names = NPM_PACKAGES.filter((name) => name in dependencies);
    assert.ok(names.length > 0, `${manifest} installs no template package`);
    const packages = jsonObject(readObject(lock).packages, `${lock} packages`);
    for (const name of names) {
      assert.equal(dependencies[name], tarball(name), `${manifest} ${name}`);
      const entry = jsonObject(packages[`node_modules/${name}`], `${lock} node_modules/${name}`);
      assert.equal(entry.resolved, tarball(name), `${lock} ${name} resolved`);
      assert.match(jsonString(entry.integrity, `${lock} ${name} integrity`), /^sha512-[A-Za-z0-9+/]{86}==$/, `${lock}: the lock pins ${name} by its sha512`);
      const integrity = jsonString(entry.integrity, `${lock} ${name} integrity`);
      const pinned = integrities.get(tarball(name)) ?? integrity;
      integrities.set(tarball(name), pinned);
      assert.equal(integrity, pinned, `${lock}: ${tarball(name)} has another integrity than in the other npm lock`);
    }
  }
});

test('Composer release declarations name the Composer repository of the release and PHPStan reads no extension stub', () => {
  // The released package names the release version; a consumer declares the Composer repository in its own root.
  assert.equal(jsonObject(readObject('packages/server/php/composer.json').require, 'packages/server/php/composer.json require')['polyspec/template'], VERSION, 'packages/server/php/composer.json');
  // Both Composer projects declare the Composer repository of the template release, its packages.json, whose dist names the
  // php zip of the release with its sha1; the lock records that dist, so Composer fetches and checks the zip itself (H27.45).
  const dists = ['composer.json', 'examples/board/composer.json'].map((manifest) => {
    const { repositories, require } = readObject(manifest);
    assert.equal(jsonObject(require, `${manifest} require`)['polyspec/template'], VERSION, manifest);
    // Beside the Composer repository of the release, each root declares the VCS repository of the opis/json-schema fork, which
    // the template decoder needs and which a library such as polyspec/template cannot declare for its consumer (H27.58).
    const declared = jsonObjects(repositories, `${manifest} repositories`).filter((item) => item.type !== 'path');
    assert.deepEqual(declared, [{ type: 'composer', url: `${RELEASE}/packages.json` }, { type: 'vcs', url: 'https://github.com/min-0-max/json-schema', 'no-api': true }], `${manifest}: the template comes from the Composer repository of the release`);
    const lockFile = manifest.replace(/\.json$/, '.lock');
    const entry = jsonObjects(readObject(lockFile).packages, `${lockFile} packages`).find(({ name }) => name === 'polyspec/template');
    assert.ok(entry !== undefined, `${manifest}: the lock has no polyspec/template`);
    assert.equal(entry.version, VERSION, manifest);
    const dist = jsonObject(entry.dist, `${lockFile} polyspec/template dist`);
    assert.equal(dist.type, 'zip', lockFile);
    assert.equal(dist.url, `${RELEASE}/polyspec-template-php-${VERSION}.zip`, lockFile);
    assert.match(jsonString(dist.shasum, `${lockFile} polyspec/template dist shasum`), /^[0-9a-f]{40}$/, `${lockFile}: the lock pins the zip by its sha1`);
    return dist;
  });
  assert.deepEqual(dists[1], dists[0], 'the two Composer locks pin different template zips');
  assert.doesNotMatch(readFileSync('packages/server/php/phpstan-max.neon', 'utf8'), /polyspec_template\.stub\.php/);
});

test('both Composer roots require the json-schema fork by a release and their locks pin its tag', () => {
  // A branch of the fork moves, so each root requires a release of the fork, as its FORK.md states, and its lock records the tag
  // of that release (H27.82).
  for (const manifest of ['composer.json', 'examples/board/composer.json']) {
    const required = jsonString(jsonObject(readObject(manifest).require, `${manifest} require`)['min-0-max/json-schema'], `${manifest} require min-0-max/json-schema`);
    assert.match(required, /^\d+\.\d+\.\d+-p\d+$/, `${manifest}: the json-schema fork is required by a release`);
    const lockFile = manifest.replace(/\.json$/, '.lock');
    const entry = jsonObjects(readObject(lockFile).packages, `${lockFile} packages`).find(({ name }) => name === 'min-0-max/json-schema');
    assert.ok(entry !== undefined, `${lockFile} has no min-0-max/json-schema`);
    assert.equal(entry.version, `v${required}`, `${lockFile}: the lock pins the tag of the release`);
  }
});

test('pyproject.toml and uv.lock name the wheel asset of the release and pin it by the same sha256', () => {
  const pyproject = readFileSync('packages/server/python/pyproject.toml', 'utf8');
  const requirements = [...pyproject.matchAll(/"polyspec-template @ ([^"#]*)#sha256=([0-9a-f]{64})"/g)];
  assert.equal(requirements.length, 1, 'pyproject.toml names the template wheel once, with its sha256');
  const [, url, sha256] = requirements[0] ?? [];
  assert.equal(url, WHEEL, 'pyproject.toml template wheel');
  const lock = readFileSync('packages/server/python/uv.lock', 'utf8');
  // The requirement of the server package, the source of polyspec-template and its wheel name the same asset.
  const urls = [...lock.matchAll(/url = "(https:\/\/github\.com\/polyspec\/template\/[^"]*)"/g)].map((match) => match[1]);
  assert.deepEqual(urls, [WHEEL, WHEEL, WHEEL], 'uv.lock names the template wheel of the release in requires-dist, source and wheels');
  const hashes = [...lock.matchAll(/\{ url = "https:\/\/github\.com\/polyspec\/template\/[^"]*", hash = "sha256:([0-9a-f]{64})" \}/g)].map((match) => match[1]);
  assert.deepEqual(hashes, [sha256], 'uv.lock pins the template wheel by the sha256 of pyproject.toml');
});
