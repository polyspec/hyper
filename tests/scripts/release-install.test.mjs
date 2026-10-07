// Installs the release assets of this repository as a consumer does, in a temporary directory outside the repository
// (HY-95): the committed fixtures of tests/release-install with their locks, `npm ci` with an empty cache and the
// scope @polyspec pointed at an unreachable registry, so a polyspec package comes only from its tarball and the
// template tarball and htmx.org are downloaded as the lock pins them (HY-89), and `composer install` from an
// `artifact` repository of the release zips and a `package` repository of the zip of the template release with an
// empty COMPOSER_HOME and cache (scripts/release-fixtures.mjs). `make release-fixtures` writes the locks.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { composerProject, consumerEnv, FIXTURES, NPM_CONSUMER, npmProject, outside, stageAssets, UNREACHABLE } from '../../scripts/release-fixtures.mjs';
import { requireBuilt } from './requires.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, `${[command, ...args].join(' ')}: ${result.stderr}${result.stdout}`);
  return result.stdout;
};

function staged(t) {
  requireBuilt('packages', 'packages/hyper-js/dist/index.js', 'packages/hyper-node/dist/index.js');
  const folder = outside();
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return { folder, ...stageAssets(ROOT, folder) };
}

test('the fixtures name the release assets of the current versions', () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'packages/hyper-js/package.json'), 'utf8'));
  const { version } = manifest;
  const template = manifest.dependencies['@polyspec/template'];
  const tarball = `https://github.com/polyspec/template/releases/download/v${template}/polyspec-template-${template}.tgz`;
  const npm = JSON.parse(readFileSync(path.join(ROOT, FIXTURES, 'npm/package.json'), 'utf8'));
  assert.deepEqual(npm.dependencies, {
    '@polyspec/hyper': `file:polyspec-hyper-${version}.tgz`,
    '@polyspec/hyper-server': `file:polyspec-hyper-server-${version}.tgz`,
    '@polyspec/template': tarball,
  });
  assert.deepEqual(npm.overrides, { '@polyspec/template': tarball });
  const lock = JSON.parse(readFileSync(path.join(ROOT, FIXTURES, 'npm/package-lock.json'), 'utf8'));
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (name === '' || String(entry.resolved).startsWith('file:')) continue;
    if (name === 'node_modules/@polyspec/template') assert.equal(entry.resolved, tarball, name);
    else assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\//, name);
    assert.match(entry.integrity, /^sha512-/, `${name} is pinned by its integrity`);
  }
  const composer = JSON.parse(readFileSync(path.join(ROOT, FIXTURES, 'composer/composer.lock'), 'utf8'));
  assert.deepEqual(composer.packages.map(({ name, version: locked }) => [name, locked]), [['polyspec/hyper', version], ['polyspec/template', template]]);
  const zip = composer.packages.find(({ name }) => name === 'polyspec/template').dist;
  assert.equal(zip.url, `https://github.com/polyspec/template/releases/download/v${template}/polyspec-template-${template}.zip`);
  assert.match(zip.shasum, /^[0-9a-f]{40}$/, 'the template zip is pinned by its shasum');
});

test('npm ci of the fixture installs the server package from the release tarballs with an empty cache', (t) => {
  const { folder, assets } = staged(t);
  const project = npmProject(ROOT, folder, assets);
  run('npm', ['ci', `--cache=${path.join(folder, 'npm-cache')}`, `--@polyspec:registry=${UNREACHABLE}`, '--fetch-retries=0', ...NPM_CONSUMER, '--no-bin-links', '--no-audit', '--no-fund'], { cwd: project, env: consumerEnv() });
  const loaded = run('node', ['--input-type=module', '-e', "const server = await import('@polyspec/hyper-server'); const hyper = await import('@polyspec/hyper'); console.log(typeof server.App, typeof hyper.Router);"], { cwd: project });
  assert.equal(loaded.trim(), 'function function');
});

test('composer install of the fixture installs the PHP package from an artifact repository of the release zips and the template zip with an empty home', (t) => {
  const { folder, assets, version, template } = staged(t);
  const project = composerProject(ROOT, folder, assets);
  run('composer', ['install', '--no-interaction', '--no-progress'], { cwd: project, env: consumerEnv({ COMPOSER_HOME: path.join(folder, 'composer-home'), COMPOSER_CACHE_DIR: path.join(folder, 'composer-cache') }) });
  const installed = JSON.parse(readFileSync(path.join(project, 'vendor/composer/installed.json'), 'utf8')).packages;
  assert.deepEqual(installed.map(({ name, version: actual }) => [name, actual]).sort(), [['polyspec/hyper', version], ['polyspec/template', template]]);
  const loaded = run('php', ['-r', "require 'vendor/autoload.php'; echo class_exists('Polyspec\\\\Hyper\\\\App') ? 'loaded' : 'missing';"], { cwd: project });
  assert.equal(loaded, 'loaded');
});
