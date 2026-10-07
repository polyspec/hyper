// Installs the release assets of this repository as a consumer does, in a temporary directory outside the repository
// (HY-95): the committed fixtures of tests/release-install with their locks, `npm ci` with an empty cache and the
// scope @polyspec pointed at an unreachable registry, so a polyspec package comes only from its tarball and the
// template tarballs and the third-party packages are downloaded as the lock pins them (HY-89), the bins of
// @polyspec/hyper-build build the sample application tests/release-install/app (HY-96), and `composer install` from an
// `artifact` repository of the release zips and a `package` repository of the zip of the template release with an
// empty COMPOSER_HOME and cache (scripts/release-fixtures.mjs). `make release-fixtures` writes the locks.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { copyTracked } from '../../scripts/tracked-files.mjs';
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
  const compiler = `https://github.com/polyspec/template/releases/download/v${template}/polyspec-template-compiler-${template}.tgz`;
  const npm = JSON.parse(readFileSync(path.join(ROOT, FIXTURES, 'npm/package.json'), 'utf8'));
  assert.deepEqual(npm.dependencies, {
    '@polyspec/hyper': `file:polyspec-hyper-${version}.tgz`,
    '@polyspec/hyper-build': `file:polyspec-hyper-build-${version}.tgz`,
    '@polyspec/hyper-server': `file:polyspec-hyper-server-${version}.tgz`,
    '@polyspec/template': tarball,
    '@polyspec/template-compiler': compiler,
    'htmx.org': manifest.dependencies['htmx.org'],
  });
  assert.deepEqual(npm.overrides, { '@polyspec/template': tarball, '@polyspec/template-compiler': compiler });
  const lock = JSON.parse(readFileSync(path.join(ROOT, FIXTURES, 'npm/package-lock.json'), 'utf8'));
  const urls = { 'node_modules/@polyspec/template': tarball, 'node_modules/@polyspec/template-compiler': compiler };
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (name === '' || String(entry.resolved).startsWith('file:')) continue;
    // A bundled package comes inside the tarball of the package that bundles it, which the lock pins by its integrity.
    if (entry.inBundle === true) {
      const parent = name.slice(0, name.lastIndexOf('/node_modules/'));
      assert.match(lock.packages[parent].integrity, /^sha512-/, `${name} is bundled in ${parent}, pinned by its integrity`);
      continue;
    }
    if (name in urls) assert.equal(entry.resolved, urls[name], name);
    else assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\//, name);
    assert.match(entry.integrity, /^sha512-/, `${name} is pinned by its integrity`);
  }
  const composer = JSON.parse(readFileSync(path.join(ROOT, FIXTURES, 'composer/composer.lock'), 'utf8'));
  assert.deepEqual(composer.packages.map(({ name, version: locked }) => [name, locked]), [['polyspec/hyper', version], ['polyspec/template', template]]);
  const zip = composer.packages.find(({ name }) => name === 'polyspec/template').dist;
  assert.equal(zip.url, `https://github.com/polyspec/template/releases/download/v${template}/polyspec-template-${template}.zip`);
  assert.match(zip.shasum, /^[0-9a-f]{40}$/, 'the template zip is pinned by its shasum');
});

test('npm ci of the fixture installs the npm packages from the release tarballs with an empty cache, and the bins of the build package build the sample application', (t) => {
  const { folder, assets } = staged(t);
  const project = npmProject(ROOT, folder, assets);
  run('npm', ['ci', `--cache=${path.join(folder, 'npm-cache')}`, `--@polyspec:registry=${UNREACHABLE}`, '--fetch-retries=0', ...NPM_CONSUMER, '--no-audit', '--no-fund'], { cwd: project, env: consumerEnv() });
  const loaded = run('node', ['--input-type=module', '-e', "const server = await import('@polyspec/hyper-server'); const hyper = await import('@polyspec/hyper'); console.log(typeof server.App, typeof hyper.Router);"], { cwd: project });
  assert.equal(loaded.trim(), 'function function');

  // HY-96: the consumer runs the bins that npm linked into node_modules/.bin on its own application.
  const app = path.join(project, 'app');
  copyTracked({ repository: ROOT, path: 'tests/release-install/app', target: app, base: 'tests/release-install/app' });
  const bin = (name) => path.join(project, 'node_modules', '.bin', name);
  const server = path.join(app, 'build', 'server');
  run(bin('hyper-build-server'), ['--manifest', 'app/app.json', '--templates', 'templates', '--output', 'build/server', '--php-namespace', 'Sample\\Program'], { cwd: app });
  for (const file of ['program.php', 'program.json', 'reads.json', 'templates/layout.tpl', 'templates/hyper/data.tpl']) assert.ok(existsSync(path.join(server, file)), file);
  assert.match(readFileSync(path.join(server, 'program.php'), 'utf8'), /^namespace Sample\\Program;$/m);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(path.join(server, 'reads.json'), 'utf8')).routes), ['home']);
  run(bin('hyper-build-assets'), ['--app', '.', '--api', '/api', '--output', 'build', '--tailwind', 'styles.css=public/assets/app.css', '--static', 'public/assets/app.css'], { cwd: app });
  const { hyper } = JSON.parse(readFileSync(path.join(app, 'build', 'manifest.json'), 'utf8'));
  assert.match(hyper, /^\/assets\/hyper-[A-Z0-9]+\.js$/);
  assert.ok(existsSync(path.join(app, 'public', hyper)), hyper);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(path.join(app, 'build', 'templates.index.json'), 'utf8'))).sort(), ['home.tpl', 'hyper/data.tpl', 'layout.tpl', 'title.tpl']);
  assert.match(readFileSync(path.join(app, 'build', 'csr', 'index.html'), 'utf8'), /<meta name="hyper-api" content="\/api">/);
  const css = readFileSync(path.join(app, 'public', 'assets', 'app.css'), 'utf8');
  assert.match(css, /\.flex\s*\{/);
  assert.match(css, /\.page\s*\{/);
  assert.ok(existsSync(path.join(app, 'build', 'csr', 'assets', 'app.css')));
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
