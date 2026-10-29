// Tests that hyper depends on one template release, 0.0.12 (H21.4, H23.23, H23.25, H23.28): the tag TEMPLATE_TAG of the Makefile, the npm packages
// and their locks, the Composer packages and their locks, the php-ext and php archives of config/release-assets.json, the Python package
// of packages/server/python, and the checkouts of the template repository in the workflows name that release and no
// other. A mixed version fails here before any install runs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { type JsonObject, jsonArray, jsonObject, jsonObjects, jsonString, parseJsonObject } from '../../scripts/json.mts';
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
const VERSION = '0.0.12';
const TAG = `v${VERSION}`;
const RELEASE = `https://github.com/polyspec/template/releases/download/${TAG}`;
const NPM_PACKAGES = ['@polyspec/template', '@polyspec/template-compiler'];
// The consumer projects of tests/release-install install the archives of the hyper release 0.0.19, and those archives
// require template 0.0.12 exactly (npm and Composer); the consumer locks are written from them on the release commit.
const CONSUMER_VERSION = '0.0.12';
const CONSUMER_RELEASE = `https://github.com/polyspec/template/releases/download/v${CONSUMER_VERSION}`;

// The entries of config/release-assets.json, and the URL of an entry with its version.
const assets = (): JsonObject[] => jsonObjects(json('config/release-assets.json').assets, 'config/release-assets.json assets');
const assetUrl = (entry: JsonObject): string =>
  jsonString(entry.url, 'config/release-assets.json url').replaceAll('{version}', jsonString(entry.version, 'config/release-assets.json version'));

test('TEMPLATE_TAG of the Makefile is the tag of the single template release (H21.4, H23.11-2)', () => {
  const lines = dryRun('template-tag', { variables: ['TEMPLATE_REPOSITORY=/nonexistent/hyper-template'] });
  assert.ok(lines.some((line) => line.includes(`'refs/tags/${TAG}^{commit}'`)), `make template-tag does not check the tag ${TAG}: ${lines.join('\n')}`);
});

test('the npm manifests name the template tarballs of the release, and their dependencies name its version (H21.4)', () => {
  const root = json('package.json');
  for (const name of NPM_PACKAGES) {
    const tarball = `${RELEASE}/${name.slice(1).replace('/', '-')}-npm-${VERSION}.tgz`;
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
    assert.equal(installed[name], `${RELEASE}/${name.slice(1).replace('/', '-')}-npm-${VERSION}.tgz`, `tests/package-install/package.json ${name}`);
  }
  const consumer = optionalMember(json('tests/release-install/npm/package.json'), 'dependencies', 'tests/release-install/npm/package.json');
  for (const name of NPM_PACKAGES.filter((name) => name in consumer)) {
    assert.equal(consumer[name], `${CONSUMER_RELEASE}/${name.slice(1).replace('/', '-')}-npm-${CONSUMER_VERSION}.tgz`, `tests/release-install/npm/package.json ${name}`);
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
      assert.equal(entry.resolved, `${RELEASE}/${name.slice(1).replace('/', '-')}-npm-${VERSION}.tgz`, `${lock} ${name} resolved`);
    }
  }
  assert.ok(member(json('package-lock.json'), 'packages', 'package-lock.json')['node_modules/@polyspec/template'], 'the root lock pins @polyspec/template');
});

test('the Composer manifests and locks name the template zip of the release (H21.4, H23.11)', () => {
  // Release applications pin the archive; native development compatibility is checked by composer-development.test.mts.
  const manifests = ['composer.json', 'examples/board/composer.json'];
  for (const manifest of manifests) {
    const require = member(json(manifest), 'require', manifest);
    if (require['polyspec/template']) assert.equal(require['polyspec/template'], VERSION, `${manifest} require`);
  }
  for (const lock of ['composer.lock', 'examples/board/composer.lock']) {
    const entry = composerPackage(lock, 'polyspec/template');
    assert.ok(entry, `${lock} locks polyspec/template`);
    assert.equal(entry.version, VERSION, `${lock} version`);
    assert.match(jsonString(member(entry, 'dist', lock).url, `${lock} dist url`), new RegExp(`(^|/)var/products/template-php/polyspec-template-php-${VERSION.replaceAll('.', '\\.')}\\.zip$`), `${lock} dist url`);
  }
});

test('the Composer consumer project of tests/release-install takes the template zip of the archives it installs from its artifact repository (H21.4, H23.11-1)', () => {
  const consumer = 'tests/release-install/composer/composer.json';
  const manifest = json(consumer);
  assert.equal(member(manifest, 'require', consumer)['polyspec/template'], CONSUMER_VERSION, `${consumer} require polyspec/template`);
  assert.deepEqual(jsonObjects(manifest.repositories, `${consumer} repositories`).filter((item) => item.type === 'package'), [], 'the consumer keeps an inline package repository');
  // kit K140: consumers.composer.polyspec names the entries of config/release-assets.json whose zips release-consumer puts
  // into the artifact repository of the project beside the archives of the tag. It runs for the next release, whose
  // archives require the template release of this tree, so it names the zip of that release (H23.23).
  const composer = member(member(json('config/release.json'), 'consumers', 'config/release.json'), 'composer', 'config/release.json consumers');
  const names = jsonArray(composer.polyspec, 'config/release.json consumers.composer.polyspec');
  const entries = assets().filter(({ name }) => names.includes(name));
  assert.deepEqual(entries.map(assetUrl), [`${RELEASE}/polyspec-template-php-${VERSION}.zip`]);
  const entry = composerPackage('tests/release-install/composer/composer.lock', 'polyspec/template');
  assert.ok(entry, 'tests/release-install/composer/composer.lock locks polyspec/template');
  // make release-consumer-lock writes the lock on the release commit (kit release-consumer.mts), so the lock of the last
  // release names its version; its dist moves to the artifact repository with the next release.
  assert.equal(entry.version, CONSUMER_VERSION);
});

test('config/release-assets.json names the php-ext and the php archives of the release (H21.4, H23.11-2)', () => {
  const urls = assets().filter(({ name }) => name === 'template-php-ext' || name === 'template-php').map(assetUrl);
  assert.deepEqual(urls, [`${RELEASE}/polyspec-template-php-ext-php-${VERSION}.zip`, `${RELEASE}/polyspec-template-php-${VERSION}.zip`]);
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

test('CI checks out the template repository at the tag of the release (H21.4)', () => {
  const refs = [...read('.github/workflows/ci.yml').matchAll(/^ {10}ref: (v\d+\.\d+\.\d+)$/gm)].map((match) => match[1]);
  assert.ok(refs.length > 0, 'ci.yml checks out the template repository');
  assert.deepEqual([...new Set(refs)], [TAG], 'ci.yml template ref');
});

// The release workflow of kit runs make release-prepare before release-tools (kit K132; make kit-check compares the
// copy): its dry run with an absent template repository clones the template at the tag of the release, checks the tag
// and installs (H23.7).
test('the release prepares the template repository at the tag of the release through release-prepare (H23.7)', () => {
  const repository = '/nonexistent/hyper-template';
  const lines = dryRun('release-prepare', { variables: [`TEMPLATE_REPOSITORY=${repository}`] });
  assert.ok(lines.some((line) => line.includes(`git clone --quiet --depth 1 --branch ${TAG} https://github.com/polyspec/template.git ${repository}`)), lines.join('\n'));
  assert.ok(lines.some((line) => line.startsWith(`git -C ${repository} rev-parse --verify --quiet 'refs/tags/${TAG}^{commit}'`)), lines.join('\n'));
  // $(MAKE) of kit-bootstrap.mk adds KIT and KIT_EXT to every recursive make, so the case compares only the target that ends the line.
  assert.ok(lines.some((line) => line.split(' ').at(-1) === 'hyper-install'), lines.join('\n'));
});
