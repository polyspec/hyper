// Tests that hyper depends on one template release, 0.0.6 (H21.4): the tag TEMPLATE_TAG of the Makefile, the npm packages
// and their locks, the Composer packages and their locks, the php-ext and php archives of config/release-assets.json, the Python package
// of packages/server/python, and the checkouts of the template repository in the workflows name that release and no
// other. A mixed version fails here before any install runs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { dryRun } from './make-dry-run.mts';

const repository = resolve('.');
const read = (file: string) => readFileSync(join(repository, file), 'utf8');
const json = (file: string) => JSON.parse(read(file));

// The template release that hyper depends on (H21.4). Every pin below names this version.
const VERSION = '0.0.6';
const TAG = `v${VERSION}`;
const RELEASE = `https://github.com/polyspec/template/releases/download/${TAG}`;
const NPM_PACKAGES = ['@polyspec/template', '@polyspec/template-compiler'];
// The consumer projects of tests/release-install install the archives of the hyper release 0.0.15, and those archives
// require template 0.0.6 exactly (npm and Composer); the consumer locks are written from them on the release commit.
const CONSUMER_VERSION = '0.0.6';
const CONSUMER_RELEASE = `https://github.com/polyspec/template/releases/download/v${CONSUMER_VERSION}`;

test('TEMPLATE_TAG of the Makefile is the tag of the single template release (H21.4, H23.11-2)', () => {
  const lines = dryRun('template-tag', { variables: ['TEMPLATE_REPOSITORY=/nonexistent/hyper-template'] });
  assert.ok(lines.some((line) => line.includes(`'refs/tags/${TAG}^{commit}'`)), `make template-tag does not check the tag ${TAG}: ${lines.join('\n')}`);
});

test('the npm manifests name the template tarballs of the release, and their dependencies name its version (H21.4)', () => {
  const root = json('package.json');
  for (const name of NPM_PACKAGES) {
    const tarball = `${RELEASE}/${name.slice(1).replace('/', '-')}-npm-${VERSION}.tgz`;
    assert.equal(root.dependencies[name], tarball, `package.json dependencies ${name}`);
    assert.equal(root.overrides[name], tarball, `package.json overrides ${name}`);
  }
  for (const manifest of ['packages/client/package.json', 'packages/server/ts/package.json', 'packages/build/package.json']) {
    const dependencies = json(manifest).dependencies ?? {};
    for (const name of NPM_PACKAGES.filter((name) => name in dependencies)) assert.equal(dependencies[name], VERSION, `${manifest} ${name}`);
  }
  const installed = json('tests/package-install/package.json').dependencies ?? {};
  assert.ok(NPM_PACKAGES.some((name) => name in installed), 'tests/package-install installs a template package');
  for (const name of NPM_PACKAGES.filter((name) => name in installed)) {
    assert.equal(installed[name], `${RELEASE}/${name.slice(1).replace('/', '-')}-npm-${VERSION}.tgz`, `tests/package-install/package.json ${name}`);
  }
  const consumer = json('tests/release-install/npm/package.json').dependencies ?? {};
  for (const name of NPM_PACKAGES.filter((name) => name in consumer)) {
    assert.equal(consumer[name], `${CONSUMER_RELEASE}/${name.slice(1).replace('/', '-')}-npm-${CONSUMER_VERSION}.tgz`, `tests/release-install/npm/package.json ${name}`);
  }
});

test('the npm locks record the template tarballs of the release (H21.4)', () => {
  for (const lock of ['package-lock.json', 'tests/package-install/package-lock.json']) {
    const packages = json(lock).packages;
    for (const name of NPM_PACKAGES) {
      const entry = packages[`node_modules/${name}`];
      if (!entry) continue;
      assert.equal(entry.version, VERSION, `${lock} ${name} version`);
      assert.equal(entry.resolved, `${RELEASE}/${name.slice(1).replace('/', '-')}-npm-${VERSION}.tgz`, `${lock} ${name} resolved`);
    }
  }
  assert.ok(json('package-lock.json').packages['node_modules/@polyspec/template'], 'the root lock pins @polyspec/template');
});

test('the Composer manifests and locks name the template zip of the release (H21.4, H23.11)', () => {
  const manifests = ['composer.json', 'packages/server/php/composer.json', 'examples/board/composer.json'];
  for (const manifest of manifests) {
    const { require } = json(manifest);
    if (require?.['polyspec/template']) assert.equal(require['polyspec/template'], VERSION, `${manifest} require`);
  }
  for (const lock of ['composer.lock', 'examples/board/composer.lock']) {
    const entry = json(lock).packages.find(({ name }: { name: string }) => name === 'polyspec/template');
    assert.equal(entry.version, VERSION, `${lock} version`);
    assert.match(entry.dist.url, new RegExp(`(^|/)var/products/template-php/polyspec-template-php-${VERSION.replaceAll('.', '\\.')}\\.zip$`), `${lock} dist url`);
  }
});

test('the Composer consumer project of tests/release-install takes the template zip of the archives it installs from its artifact repository (H21.4, H23.11-1)', () => {
  const { require, repositories } = json('tests/release-install/composer/composer.json');
  assert.equal(require['polyspec/template'], CONSUMER_VERSION, 'tests/release-install/composer/composer.json require polyspec/template');
  assert.deepEqual(repositories.filter((item: { type?: string }) => item.type === 'package'), [], 'the consumer keeps an inline package repository');
  // kit K140: consumers.composer.polyspec names the entries of config/release-assets.json whose zips release-consumer puts
  // into the artifact repository of the project beside the archives of the tag.
  const names: string[] = json('config/release.json').consumers.composer.polyspec;
  const entries = json('config/release-assets.json').assets.filter(({ name }: { name: string }) => names.includes(name));
  assert.deepEqual(entries.map(({ url, version }: { url: string; version: string }) => url.replaceAll('{version}', version)), [`${CONSUMER_RELEASE}/polyspec-template-php-${CONSUMER_VERSION}.zip`]);
  const entry = json('tests/release-install/composer/composer.lock').packages.find(({ name }: { name: string }) => name === 'polyspec/template');
  // make release-consumer-lock writes the lock on the release commit (kit release-consumer.mts), so the lock of the last
  // release names its version; its dist moves to the artifact repository with the next release.
  assert.equal(entry.version, CONSUMER_VERSION);
});

test('config/release-assets.json names the php-ext and the php archives of the release (H21.4, H23.11-2)', () => {
  const assets = json('config/release-assets.json').assets.filter(({ name }: { name: string }) => name === 'template-php-ext' || name === 'template-php');
  const urls = assets.map(({ url, version }: { url: string; version: string }) => url.replaceAll('{version}', version));
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
  assert.ok(lines.some((line) => line.endsWith('make install')), lines.join('\n'));
});
