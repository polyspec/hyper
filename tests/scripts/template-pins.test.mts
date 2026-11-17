// Tests the template pins of this repository (HR-70, HR-80, H14.1-7, H27.57, H31.5): every install verifies each template
// asset that it installs by its integrity. Each manifest names the template release by its version or the URL of its asset,
// and each lock pins that asset by its integrity: the sha512 of the npm locks and the sha256 of the Python wheels in
// pyproject.toml and uv.lock. The PHP template is the extension polyspec_template, the php-ext package polyspec/template of
// the Composer repository of the release, which PIE builds; the Composer roots require the extension and lock no template
// package. Workspaces resolve the same installed template package, including a source link, and PHPStan reads the PHP
// library without an extension stub.
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
// The platform of the Composer manifest `file`.
const platform = (file: string) => jsonObject(jsonObject(readObject(file).config, `${file} config`).platform, `${file} platform`);
// The template release: the exact version that the platform of the private root composer.json declares for
// ext-polyspec_template; every pin below names it.
const VERSION = jsonString(platform('composer.json')['ext-polyspec_template'], 'composer.json platform ext-polyspec_template');
const RELEASE = `https://github.com/polyspec/template/releases/download/v${VERSION}`;
// The json release whose extension the template extension requires (HY-48.15): the version that the platform of the
// root composer.json declares for ext-polyspec_json, whose Composer repository both Composer roots declare.
const JSON_VERSION = jsonString(platform('composer.json')['ext-polyspec_json'], 'composer.json platform ext-polyspec_json');
const JSON_PACKAGES = `https://github.com/polyspec/json/releases/download/v${JSON_VERSION}/packages.json`;
// The package @polyspec/template and its platform packages, which hold the native module of the napi root.
const NPM_PACKAGE = '@polyspec/template';
const NPM_PLATFORMS = ['@polyspec/template-darwin-arm64', '@polyspec/template-linux-arm64-gnu', '@polyspec/template-linux-x64-gnu'];
// The tarball asset of the npm package `name` of the release.
const tarball = (name: string) => `${RELEASE}/${name.slice(1).replace('/', '-')}-${VERSION}.tgz`;
// The wheel assets of the release, one for each platform.
const WHEELS = ['macosx_11_0_arm64', 'manylinux_2_34_aarch64', 'manylinux_2_34_x86_64'].map((tag) => `${RELEASE}/polyspec_template-${VERSION}-cp314-abi3-${tag}.whl`);

test('the template release is one exact version', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/, 'composer.json declares an exact template extension version');
});

test('workspaces resolve the same installed template package through native source links or an installation', () => {
  requireBuilt('hyper-install', 'node_modules/@polyspec/template/package.json');
  assert.equal(readObject('node_modules/@polyspec/template/package.json').name, '@polyspec/template');
  const render = createRequire(join(repository, 'package.json')).resolve('@polyspec/template/render');
  for (const workspace of ['packages/client', 'packages/ts', 'packages/cli']) {
    assert.equal(createRequire(join(repository, workspace, 'package.json')).resolve('@polyspec/template/render'), render, workspace);
  }
});

test('the npm manifests name the tarball assets of the release and their locks pin them by integrity', () => {
  // One asset has one sha512: npm keeps the integrity of a lock entry when only its URL changes, and an offline install
  // finds no cached tarball for a stale one (H27.63).
  const integrities = new Map<string, string>();
  const root = readObject('package.json');
  const pins: [string, string, string[]][] = [
    ['package.json', 'package-lock.json', [NPM_PACKAGE, ...NPM_PLATFORMS]],
    ['tests/package-install/package.json', 'tests/package-install/package-lock.json', [NPM_PACKAGE]],
  ];
  for (const name of NPM_PLATFORMS) {
    assert.equal(jsonObject(root.optionalDependencies, 'package.json optionalDependencies')[name], tarball(name), `package.json optionalDependencies ${name}`);
  }
  for (const [manifest, lock, names] of pins) {
    const declared = readObject(manifest);
    const dependencies = { ...jsonObject(declared.dependencies, `${manifest} dependencies`), ...(declared.optionalDependencies === undefined ? {} : jsonObject(declared.optionalDependencies, `${manifest} optionalDependencies`)) };
    const packages = jsonObject(readObject(lock).packages, `${lock} packages`);
    for (const name of names) {
      assert.equal(dependencies[name], tarball(name), `${manifest} ${name}`);
      const entry = jsonObject(packages[`node_modules/${name}`], `${lock} node_modules/${name}`);
      assert.equal(entry.resolved, tarball(name), `${lock} ${name} resolved`);
      const integrity = jsonString(entry.integrity, `${lock} ${name} integrity`);
      assert.match(integrity, /^sha512-[A-Za-z0-9+/]{86}==$/, `${lock}: the lock pins ${name} by its sha512`);
      const pinned = integrities.get(tarball(name)) ?? integrity;
      integrities.set(tarball(name), pinned);
      assert.equal(integrity, pinned, `${lock}: ${tarball(name)} has another integrity than in the other npm lock`);
    }
  }
});

test('Composer roots require the template extension from the Composer repository of the release and PHPStan reads no extension stub', () => {
  // The released package requires the extension; a consumer declares the Composer repository in its own root.
  assert.equal(jsonObject(readObject('packages/php/composer.json').require, 'packages/php/composer.json require')['ext-polyspec_template'], '*', 'packages/php/composer.json');
  assert.equal(platform('packages/php/composer.json')['ext-polyspec_template'], VERSION, 'packages/php/composer.json platform');
  for (const manifest of ['composer.json', 'examples/board/composer.json']) {
    const { repositories, require } = readObject(manifest);
    const required = jsonObject(require, `${manifest} require`);
    assert.equal(required['ext-polyspec_template'], '*', manifest);
    assert.equal(required['polyspec/template'], undefined, `${manifest}: the template is the extension, not a Composer library`);
    assert.equal(platform(manifest)['ext-polyspec_template'], VERSION, `${manifest} platform`);
    // Beside the Composer repository of the release, each root declares the VCS repository of the opis/json-schema fork, which
    // the template decoder needs and which a library cannot declare for its consumer (H27.58).
    const declared = jsonObjects(repositories, `${manifest} repositories`).filter((item) => item.type !== 'path');
    assert.deepEqual(declared, [{ type: 'composer', url: `${RELEASE}/packages.json` }, { type: 'composer', url: JSON_PACKAGES }, { type: 'vcs', url: 'https://github.com/min-0-max/json-schema', 'no-api': true }], `${manifest}: the template comes from the Composer repository of the release`);
    const lockFile = manifest.replace(/\.json$/, '.lock');
    const entry = jsonObjects(readObject(lockFile).packages, `${lockFile} packages`).find(({ name }) => name === 'polyspec/template');
    assert.equal(entry, undefined, `${lockFile} locks no polyspec/template`);
  }
  assert.doesNotMatch(readFileSync('packages/php/phpstan-max.neon', 'utf8'), /polyspec_template\.stub\.php/);
});

test('both Composer roots require the json-schema fork from a release and their locks pin its tag', () => {
  // A branch of the fork moves, so each root requires the fork from a release, as its FORK.md states, and its lock records the
  // tag of that release (H27.82). The range starts at the release, because composer validate --strict fails an exact
  // constraint (H28.17).
  for (const manifest of ['composer.json', 'examples/board/composer.json']) {
    const required = jsonString(jsonObject(readObject(manifest).require, `${manifest} require`)['min-0-max/json-schema'], `${manifest} require min-0-max/json-schema`);
    const release = /^\^(\d+\.\d+\.\d+-p\d+)$/.exec(required)?.[1];
    assert.ok(release !== undefined, `${manifest}: the json-schema fork is required by a caret range from a release, not ${required}`);
    const lockFile = manifest.replace(/\.json$/, '.lock');
    const entry = jsonObjects(readObject(lockFile).packages, `${lockFile} packages`).find(({ name }) => name === 'min-0-max/json-schema');
    assert.ok(entry !== undefined, `${lockFile} has no min-0-max/json-schema`);
    assert.equal(entry.version, `v${release}`, `${lockFile}: the lock pins the tag of the release`);
  }
});

test('pyproject.toml and uv.lock name the wheel assets of the release and pin each by the same sha256', () => {
  const pyproject = readFileSync('packages/python/pyproject.toml', 'utf8');
  const requirements = [...pyproject.matchAll(/"polyspec-template @ ([^"#]*)#sha256=([0-9a-f]{64}) ; [^"]*"/g)];
  assert.deepEqual(requirements.map((match) => match[1]), WHEELS, 'pyproject.toml names each template wheel once, with its sha256 and its platform');
  const lock = readFileSync('packages/python/uv.lock', 'utf8');
  for (const requirement of requirements) {
    const [, url, sha256] = requirement;
    assert.ok(lock.includes(`{ url = "${url}", hash = "sha256:${sha256}" }`), `uv.lock pins ${url} by the sha256 of pyproject.toml`);
  }
  const urls = new Set([...lock.matchAll(/"(https:\/\/github\.com\/polyspec\/template\/[^"]*)"/g)].map((match) => match[1]));
  assert.deepEqual([...urls].sort(), [...WHEELS].sort(), 'uv.lock names only the template wheels of the release');
});
