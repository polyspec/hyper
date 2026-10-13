// Tests that hyper depends on one template release, 0.0.6 (H21.4): the tag TEMPLATE_TAG of the Makefile, the npm packages
// and their locks, the Composer packages and their locks, the php-ext asset of config/template-ext.json, the Python package
// of packages/hyper-server-python, and the checkouts of the template repository in the workflows name that release and no
// other. A mixed version fails here before any install runs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const repository = resolve('.');
const read = (file) => readFileSync(join(repository, file), 'utf8');
const json = (file) => JSON.parse(read(file));

// The template release that hyper depends on (H21.4). Every pin below names this version.
const VERSION = '0.0.6';
const TAG = `v${VERSION}`;
const RELEASE = `https://github.com/polyspec/template/releases/download/${TAG}`;
const NPM_PACKAGES = ['@polyspec/template', '@polyspec/template-compiler'];
// The consumer projects of tests/release-install install the published archives of the hyper release 0.0.13, and those
// archives require template 0.0.5 exactly (npm and Composer). They keep that version until a release whose archives
// require VERSION is published and its consumer locks are written from it (H21.3 procedure).
const CONSUMER_VERSION = '0.0.5';
const CONSUMER_RELEASE = `https://github.com/polyspec/template/releases/download/v${CONSUMER_VERSION}`;

test('TEMPLATE_TAG of the Makefile is the tag of the single template release (H21.4)', () => {
  const tag = /^TEMPLATE_TAG := (\S+)$/m.exec(read('Makefile'))?.[1];
  assert.equal(tag, TAG, `TEMPLATE_TAG is ${tag}, expected ${TAG}`);
});

test('the npm manifests name the template tarballs of the release, and their dependencies name its version (H21.4)', () => {
  const root = json('package.json');
  for (const name of NPM_PACKAGES) {
    const tarball = `${RELEASE}/${name.slice(1).replace('/', '-')}-npm-${VERSION}.tgz`;
    assert.equal(root.dependencies[name], tarball, `package.json dependencies ${name}`);
    assert.equal(root.overrides[name], tarball, `package.json overrides ${name}`);
  }
  for (const manifest of ['packages/hyper-client/package.json', 'packages/hyper-server-node/package.json', 'packages/hyper-build/package.json']) {
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

test('the Composer manifests and locks name the template zip of the release (H21.4)', () => {
  const manifests = ['composer.json', 'packages/hyper-server-php/composer.json', 'examples/board/composer.json'];
  for (const manifest of manifests) {
    const { require, repositories = [] } = json(manifest);
    if (require?.['polyspec/template']) assert.equal(require['polyspec/template'], VERSION, `${manifest} require`);
    for (const item of repositories.filter((item) => item.type === 'package' && item.package?.name === 'polyspec/template')) {
      assert.equal(item.package.version, VERSION, `${manifest} repository version`);
      assert.equal(item.package.dist.url, `${RELEASE}/polyspec-template-php-${VERSION}.zip`, `${manifest} repository dist url`);
    }
  }
  for (const lock of ['composer.lock', 'examples/board/composer.lock']) {
    const entry = json(lock).packages.find(({ name }) => name === 'polyspec/template');
    assert.equal(entry.version, VERSION, `${lock} version`);
    assert.equal(entry.dist.url, `${RELEASE}/polyspec-template-php-${VERSION}.zip`, `${lock} dist url`);
  }
});

test('the Composer consumer project of tests/release-install names the template version of the archives it installs (H21.4)', () => {
  const { require, repositories } = json('tests/release-install/composer/composer.json');
  if (require['polyspec/template']) assert.equal(require['polyspec/template'], CONSUMER_VERSION);
  const item = repositories.find((item) => item.type === 'package' && item.package?.name === 'polyspec/template');
  assert.equal(item.package.version, CONSUMER_VERSION);
  assert.equal(item.package.dist.url, `${CONSUMER_RELEASE}/polyspec-template-php-${CONSUMER_VERSION}.zip`);
  const entry = json('tests/release-install/composer/composer.lock').packages.find(({ name }) => name === 'polyspec/template');
  assert.equal(entry.version, CONSUMER_VERSION);
});

test('config/template-ext.json names the php-ext asset of the release (H21.4)', () => {
  const config = json('config/template-ext.json');
  assert.equal(config.tag, TAG);
  assert.equal(config.asset, `polyspec-template-php-ext-php-${VERSION}.zip`);
});

test('the Python package of the server names the wheel asset of the release with its sha256 (H21.4, H23.5)', () => {
  const pyproject = read('packages/hyper-server-python/pyproject.toml');
  const requirements = [...pyproject.matchAll(/"(polyspec-template @ [^"]*)"/g)].map((match) => match[1]);
  assert.deepEqual(
    requirements.map((requirement) => requirement.replace(/#sha256=[0-9a-f]{64}$/, '#sha256=<hex>')),
    [`polyspec-template @ ${RELEASE}/polyspec_template-${VERSION}-py3-none-any.whl#sha256=<hex>`],
    'pyproject.toml names the template wheel of the release asset and the sha256 of that asset',
  );
});

test('the workflows check out the template repository at the tag of the release (H21.4)', () => {
  for (const workflow of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
    const refs = [...read(workflow).matchAll(/^ {10}ref: (v\d+\.\d+\.\d+)$/gm)].map((match) => match[1]);
    assert.ok(refs.length > 0, `${workflow} checks out the template repository`);
    assert.deepEqual([...new Set(refs)], [TAG], `${workflow} template ref`);
  }
});
