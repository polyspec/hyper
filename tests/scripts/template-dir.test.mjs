// Tests that the asset build, the template build and the server build read the template packages that this repository
// installs, @polyspec/template and @polyspec/template-compiler, by their package names (HY-70): npm installs them from
// the tarballs of the template release that the root package.json names by their URLs and package-lock.json pins by
// their integrity, and no build takes a template directory.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { bundlePackage } from '../../scripts/template-files.mjs';
import { requireBuilt } from './requires.mjs';

const repository = resolve('.');
const installed = resolve('node_modules', '@polyspec', 'template');
const PACKAGES = ['@polyspec/template', '@polyspec/template-compiler'];
const read = (file) => JSON.parse(readFileSync(join(repository, file), 'utf8'));

test('bundles the browser package with the installed template package', async () => {
  requireBuilt('install', 'node_modules/@polyspec/template/package.json');
  const inputs = Object.keys((await bundlePackage()).metafile.inputs).map((input) => resolve(input));
  assert.ok(inputs.some((input) => input.startsWith(`${installed}/dist/`)), inputs.join('\n'));
  assert.deepEqual(inputs.filter((input) => input.includes('/var/products/')), []);
});

test('npm installs the template packages from the tarballs of the template release that the lock pins', () => {
  requireBuilt('install', ...PACKAGES.map((name) => `node_modules/${name}/package.json`));
  const root = read('package.json');
  const lock = read('package-lock.json');
  const version = read('packages/hyper-js/package.json').dependencies['@polyspec/template'];
  assert.match(version, /^\d+\.\d+\.\d+$/, 'packages/hyper-js requires an exact template version');
  assert.equal(read('packages/hyper-node/package.json').dependencies['@polyspec/template'], version);
  for (const name of PACKAGES) {
    const tarball = `https://github.com/polyspec/template/releases/download/v${version}/${name.slice(1).replace('/', '-')}-${version}.tgz`;
    assert.equal(root.dependencies[name], tarball, name);
    const entry = lock.packages[`node_modules/${name}`];
    assert.equal(entry.resolved, tarball, name);
    assert.equal(entry.version, version, name);
    assert.match(entry.integrity, /^sha512-/, `${name} is pinned by its integrity`);
    assert.equal(read(`node_modules/${name}/package.json`).version, version, name);
  }
  // The packages of the workspace require the exact version, which the root resolves to the same tarball.
  assert.equal(root.overrides['@polyspec/template'], root.dependencies['@polyspec/template']);
  assert.match(readFileSync(join(repository, '.npmrc'), 'utf8'), /^allow-remote=root$/m);
});

test('the asset build, the template build and the server build take no template directory', () => {
  const runs = {
    'build-assets.mjs': ['--app', 'examples/board', '--api', '/api', '--output', '/nonexistent'],
    'build-templates.mjs': ['--templates', 'examples/board/templates', '--output', '/nonexistent'],
    'build-server.mjs': ['--manifest', 'examples/board/app/app.json', '--templates', 'examples/board/templates', '--output', '/nonexistent', '--php-namespace', 'X'],
  };
  for (const [script, options] of Object.entries(runs)) {
    const result = spawnSync(process.execPath, [join(repository, 'scripts', script), ...options, '--template-dir', 'var/products/template'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, script);
    assert.match(result.stderr, /Unknown option '--template-dir'/, script);
  }
});
