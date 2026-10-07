// Installs the release assets of this repository as a consumer does, in a temporary directory outside the repository
// (HY-95): the committed fixtures of tests/release-install with their locks, `npm ci` with an empty cache and the
// scope @polyspec pointed at an unreachable registry, so a polyspec package comes only from its tarball and htmx.org
// is downloaded as the lock pins it (HY-89), and `composer install` from an `artifact` repository of the release zips
// with an empty COMPOSER_HOME and cache. The template archives are packed from the declared copy of the template
// repository (HY-78) at the version of TEMPLATE_TAG (scripts/release-fixtures.mjs). `make release-fixtures` writes
// the locks.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { composerProject, consumerEnv, FIXTURES, npmProject, outside, stageAssets, UNREACHABLE } from '../../scripts/release-fixtures.mjs';
import { templateDir } from './declared-template.mjs';
import { requireBuilt } from './requires.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, `${[command, ...args].join(' ')}: ${result.stderr}${result.stdout}`);
  return result.stdout;
};

function staged(t) {
  requireBuilt('packages', 'packages/hyper-js/dist/index.js', 'packages/hyper-node/dist/index.js');
  requireBuilt('template', path.relative(ROOT, path.join(templateDir, 'packages/template-ts/dist/index.mjs')));
  const folder = outside();
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return { folder, ...stageAssets(ROOT, templateDir, folder) };
}

test('the fixtures name the release assets of the current versions', () => {
  const version = JSON.parse(readFileSync(path.join(ROOT, 'packages/hyper-js/package.json'), 'utf8')).version;
  const template = JSON.parse(readFileSync(path.join(templateDir, 'packages/template-ts/package.json'), 'utf8')).version;
  const npm = JSON.parse(readFileSync(path.join(ROOT, FIXTURES, 'npm/package.json'), 'utf8'));
  assert.deepEqual(npm.dependencies, {
    '@polyspec/hyper': `file:polyspec-hyper-${version}.tgz`,
    '@polyspec/hyper-server': `file:polyspec-hyper-server-${version}.tgz`,
    '@polyspec/template': `file:polyspec-template-${template}.tgz`,
  });
  const lock = JSON.parse(readFileSync(path.join(ROOT, FIXTURES, 'npm/package-lock.json'), 'utf8'));
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (name === '' || String(entry.resolved).startsWith('file:')) continue;
    assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\//, name);
    assert.match(entry.integrity, /^sha512-/, `${name} is pinned by its integrity`);
  }
  const composer = JSON.parse(readFileSync(path.join(ROOT, FIXTURES, 'composer/composer.lock'), 'utf8'));
  assert.deepEqual(composer.packages.map(({ name, version: locked }) => [name, locked]), [['polyspec/hyper', version], ['polyspec/template', template]]);
});

test('npm ci of the fixture installs the server package from the release tarballs with an empty cache', (t) => {
  const { folder, assets } = staged(t);
  const project = npmProject(ROOT, folder, assets);
  run('npm', ['ci', `--cache=${path.join(folder, 'npm-cache')}`, `--@polyspec:registry=${UNREACHABLE}`, '--fetch-retries=0', '--no-bin-links', '--no-audit', '--no-fund'], { cwd: project, env: consumerEnv() });
  const loaded = run('node', ['--input-type=module', '-e', "const server = await import('@polyspec/hyper-server'); const hyper = await import('@polyspec/hyper'); console.log(typeof server.App, typeof hyper.Router);"], { cwd: project });
  assert.equal(loaded.trim(), 'function function');
});

test('composer install of the fixture installs the PHP package from an artifact repository of the release zips with an empty home', (t) => {
  const { folder, assets, version } = staged(t);
  const project = composerProject(ROOT, folder, assets);
  run('composer', ['install', '--no-interaction', '--no-progress'], { cwd: project, env: consumerEnv({ COMPOSER_HOME: path.join(folder, 'composer-home'), COMPOSER_CACHE_DIR: path.join(folder, 'composer-cache') }) });
  const installed = JSON.parse(readFileSync(path.join(project, 'vendor/composer/installed.json'), 'utf8')).packages;
  assert.deepEqual(installed.map(({ name, version: actual }) => [name, actual]).sort(), [['polyspec/hyper', version], ['polyspec/template', JSON.parse(readFileSync(path.join(templateDir, 'packages/template-ts/package.json'), 'utf8')).version]]);
  const loaded = run('php', ['-r', "require 'vendor/autoload.php'; echo class_exists('Polyspec\\\\Hyper\\\\App') ? 'loaded' : 'missing';"], { cwd: project });
  assert.equal(loaded, 'loaded');
});
