// Installs the release assets of this repository outside the repository (scripts/release.mjs, HY-95): an npm project
// in a temporary directory installs @polyspec/hyper-server with every tarball that it needs listed as `file:`, and a
// Composer project installs polyspec/hyper from an `artifact` repository of the packed zips. The template packages are
// packed from the declared copy of the template repository (HY-78) and stand in for its release assets. No case reaches
// GitHub or a registry; htmx.org comes from the npm cache that `make install` fills.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { assetName, buildAssets, PACKAGES, packedManifests } from '../../scripts/release.mjs';
import { templateDir } from './declared-template.mjs';
import { requireBuilt } from './requires.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, `${[command, ...args].join(' ')}: ${result.stderr}${result.stdout}`);
  return result.stdout;
};

/** A temporary directory outside the repository, removed after the test. */
function outside(t) {
  const folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'hyper-release-install-')));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  assert.ok(path.relative(ROOT, folder).startsWith('..'), `${folder} is inside the repository`);
  return folder;
}

/** The assets of the current commit at the version of the manifests, built into `folder/assets`. */
function packed(folder) {
  const version = JSON.parse(readFileSync(path.join(ROOT, 'packages/hyper-js/package.json'), 'utf8')).version;
  const target = path.join(folder, 'assets');
  const commit = run('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).trim();
  const names = buildAssets(ROOT, commit, `v${version}`, target);
  return { version, target, names };
}

test('an npm project outside the repository installs the server package from the release tarballs', (t) => {
  requireBuilt('packages', 'packages/hyper-js/dist/index.js', 'packages/hyper-node/dist/index.js');
  requireBuilt('template', path.relative(ROOT, path.join(templateDir, 'packages/template-ts/dist/index.mjs')));
  const folder = outside(t);
  const { version, target, names } = packed(folder);
  const template = JSON.parse(readFileSync(path.join(templateDir, 'packages/template-ts/package.json'), 'utf8'));
  run('npm', ['pack', '--pack-destination', target], { cwd: path.join(templateDir, 'packages/template-ts') });
  // The consumer lists every tarball that it needs; each exact version of a packed manifest is satisfied by the
  // tarball installed beside it.
  const tarballs = { '@polyspec/template': assetName(template.name, template.version, 'tgz') };
  for (const { kind, name } of PACKAGES) if (kind === 'npm') tarballs[name] = assetName(name, version, 'tgz');
  assert.deepEqual(Object.values(tarballs).filter((file) => names.includes(file)).length, 2);
  const project = path.join(folder, 'project');
  mkdirSync(project);
  const dependencies = Object.fromEntries(Object.entries(tarballs).map(([name, file]) => [name, `file:${path.join(target, file)}`]));
  writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'release-install', private: true, type: 'module', dependencies }, null, 2));
  run('npm', ['install', '--offline', '--no-bin-links', '--no-audit', '--no-fund'], { cwd: project });
  const loaded = run('node', ['--input-type=module', '-e', "const server = await import('@polyspec/hyper-server'); const hyper = await import('@polyspec/hyper'); console.log(typeof server.App, typeof hyper.Router);"], { cwd: project });
  assert.equal(loaded.trim(), 'function function');
  const lock = JSON.parse(readFileSync(path.join(project, 'package-lock.json'), 'utf8'));
  for (const name of ['@polyspec/hyper', '@polyspec/hyper-server', '@polyspec/template']) {
    const entry = lock.packages[`node_modules/${name}`];
    assert.equal(entry.resolved, `file:${path.relative(project, path.join(target, tarballs[name]))}`, name);
  }
});

test('a Composer project outside the repository installs the PHP package from an artifact repository of the release zips', (t) => {
  requireBuilt('template', path.relative(ROOT, path.join(templateDir, 'packages/template-php/composer.json')));
  const folder = outside(t);
  const { version, target } = packed(folder);
  for (const file of readdirSync(target).filter((name) => !name.endsWith('.zip'))) rmSync(path.join(target, file));
  // The zip of the template PHP package: its tracked files with the version of its npm package, archived by git.
  const template = JSON.parse(readFileSync(path.join(templateDir, 'packages/template-ts/package.json'), 'utf8')).version;
  const source = path.join(folder, 'template-php');
  cpSync(path.join(templateDir, 'packages/template-php'), source, { recursive: true, filter: (file) => !file.includes(`${path.sep}vendor`) });
  const composer = JSON.parse(readFileSync(path.join(source, 'composer.json'), 'utf8'));
  writeFileSync(path.join(source, 'composer.json'), JSON.stringify({ name: composer.name, version: template, ...composer }, null, 4));
  run('git', ['init', '--quiet'], { cwd: source });
  run('git', ['add', '-A'], { cwd: source });
  const tree = run('git', ['write-tree'], { cwd: source }).trim();
  run('git', ['archive', '--format=zip', `--output=${path.join(target, assetName('polyspec/template', template, 'zip'))}`, tree], { cwd: source });
  const project = path.join(folder, 'project');
  mkdirSync(project);
  writeFileSync(path.join(project, 'composer.json'), JSON.stringify({
    name: 'release/install',
    version: '1.0.0',
    repositories: [{ type: 'artifact', url: target }, { 'packagist.org': false }],
    require: { 'polyspec/hyper': version },
  }, null, 4));
  run('composer', ['install', '--no-interaction', '--no-progress'], { cwd: project });
  const lock = JSON.parse(readFileSync(path.join(project, 'composer.lock'), 'utf8'));
  assert.deepEqual(lock.packages.map(({ name, version: installed }) => [name, installed]).sort(), [['polyspec/hyper', version], ['polyspec/template', template]]);
  const loaded = run('php', ['-r', "require 'vendor/autoload.php'; echo class_exists('Polyspec\\\\Hyper\\\\App') ? 'loaded' : 'missing';"], { cwd: project });
  assert.equal(loaded, 'loaded');
});
