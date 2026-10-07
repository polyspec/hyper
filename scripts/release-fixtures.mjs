#!/usr/bin/env node
// The consumer fixtures of the release assets (HY-95, HY-89): tests/release-install/npm holds a package.json that
// depends on the release tarballs by `file:` and its package-lock.json, and tests/release-install/composer a
// composer.json with an `artifact` repository of the release zips and its composer.lock. The test
// tests/scripts/release-install.test.mjs installs them in a temporary directory outside the repository with `npm ci`
// and `composer install`; `make release-fixtures` writes the locks.
//
//   node scripts/release-fixtures.mjs --template-dir <declared template copy>
//
// The assets are the archives of `buildAssets` at the version of packages/hyper-js/package.json, and the template
// archives are packed from the declared copy of the template repository (HY-78) at the version of TEMPLATE_TAG. The
// npm lock pins every third-party package with its exact version and integrity; a polyspec package is a local
// tarball of the same run, so its lock entry names the file without an integrity, and the Composer lock names each zip
// without a shasum. The locks change when a release version or a dependency changes, never with the content of an
// archive.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { assetName, buildAssets } from './release.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURES = 'tests/release-install';
// A registry address that refuses every connection: port 9 of the loopback address. The scope @polyspec points at
// it, so a polyspec package comes only from its tarball.
export const UNREACHABLE = 'http://127.0.0.1:9/';

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`${[command, ...args].join(' ')} exited with ${result.status}: ${result.stderr}${result.stdout}`);
  return result.stdout;
};

/** The environment of a consumer install: the offline settings of the Makefile removed (HY-89). */
export const consumerEnv = (extra = {}) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !['npm_config_offline', 'COMPOSER_DISABLE_NETWORK'].includes(name))), ...extra });

/** A temporary directory outside the repository. */
export function outside() {
  const folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'hyper-release-install-')));
  if (!path.relative(ROOT, folder).startsWith('..')) throw new Error(`${folder} is inside the repository`);
  return folder;
}

/** The release archives of this repository and the template archives in `folder/assets`; their names. */
export function stageAssets(root, templateDir, folder) {
  const version = JSON.parse(readFileSync(path.join(root, 'packages/hyper-js/package.json'), 'utf8')).version;
  const assets = path.join(folder, 'assets');
  const commit = run('git', ['rev-parse', 'HEAD'], { cwd: root }).trim();
  buildAssets(root, commit, `v${version}`, assets);
  const template = JSON.parse(readFileSync(path.join(templateDir, 'packages/template-ts/package.json'), 'utf8')).version;
  run('npm', ['pack', '--pack-destination', assets], { cwd: path.join(templateDir, 'packages/template-ts') });
  // The zip of the template PHP package: its files with the version of the template release, archived by git.
  const source = path.join(folder, 'template-php');
  cpSync(path.join(templateDir, 'packages/template-php'), source, { recursive: true, filter: (file) => path.basename(file) !== 'vendor' });
  const composer = JSON.parse(readFileSync(path.join(source, 'composer.json'), 'utf8'));
  writeFileSync(path.join(source, 'composer.json'), `${JSON.stringify({ name: composer.name, version: template, ...composer }, null, 4)}\n`);
  run('git', ['init', '--quiet'], { cwd: source });
  run('git', ['add', '-A'], { cwd: source });
  const tree = run('git', ['write-tree'], { cwd: source }).trim();
  run('git', ['archive', '--format=zip', `--output=${path.join(assets, assetName('polyspec/template', template, 'zip'))}`, tree], { cwd: source });
  rmSync(source, { recursive: true, force: true });
  return { version, template, assets };
}

/** The npm consumer: the fixture and every tarball that its package.json names, in `folder/npm`. */
export function npmProject(root, folder, assets, { lock = true } = {}) {
  const project = path.join(folder, 'npm');
  mkdirSync(project, { recursive: true });
  const manifest = JSON.parse(readFileSync(path.join(root, FIXTURES, 'npm/package.json'), 'utf8'));
  writeFileSync(path.join(project, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (lock) cpSync(path.join(root, FIXTURES, 'npm/package-lock.json'), path.join(project, 'package-lock.json'));
  for (const spec of Object.values(manifest.dependencies)) {
    const file = spec.replace(/^file:/, '');
    if (!existsSync(path.join(assets, file))) throw new Error(`${FIXTURES}/npm/package.json names ${file}, which is not a built asset; the release versions changed, run make release-fixtures`);
    cpSync(path.join(assets, file), path.join(project, file));
  }
  return project;
}

/** The Composer consumer: the fixture and the zips in its artifact repository `folder/composer/assets`. */
export function composerProject(root, folder, assets, { lock = true } = {}) {
  const project = path.join(folder, 'composer');
  mkdirSync(path.join(project, 'assets'), { recursive: true });
  cpSync(path.join(root, FIXTURES, 'composer/composer.json'), path.join(project, 'composer.json'));
  if (lock) cpSync(path.join(root, FIXTURES, 'composer/composer.lock'), path.join(project, 'composer.lock'));
  for (const file of readdirSync(assets).filter((name) => name.endsWith('.zip'))) cpSync(path.join(assets, file), path.join(project, 'assets', file));
  return project;
}

/** Write the locks of both fixtures from the assets of the tree. */
export function writeLocks(root, templateDir) {
  const folder = outside();
  try {
    const { assets } = stageAssets(root, templateDir, folder);
    const npm = npmProject(root, folder, assets, { lock: false });
    run('npm', ['install', '--package-lock-only', `--cache=${path.join(folder, 'npm-cache')}`, `--@polyspec:registry=${UNREACHABLE}`, '--fetch-retries=0', '--no-audit', '--no-fund'], { cwd: npm, env: consumerEnv() });
    const npmLock = JSON.parse(readFileSync(path.join(npm, 'package-lock.json'), 'utf8'));
    for (const entry of Object.values(npmLock.packages)) if (String(entry.resolved).startsWith('file:')) delete entry.integrity;
    writeFileSync(path.join(root, FIXTURES, 'npm/package-lock.json'), `${JSON.stringify(npmLock, null, 2)}\n`);
    const composer = composerProject(root, folder, assets, { lock: false });
    run('composer', ['update', '--no-install', '--no-interaction'], { cwd: composer, env: consumerEnv({ COMPOSER_HOME: path.join(folder, 'composer-home'), COMPOSER_CACHE_DIR: path.join(folder, 'composer-cache') }) });
    const composerLock = JSON.parse(readFileSync(path.join(composer, 'composer.lock'), 'utf8'));
    for (const entry of composerLock.packages) if (entry.dist?.type === 'zip' && entry.dist.url.startsWith('assets/')) delete entry.dist.shasum;
    writeFileSync(path.join(root, FIXTURES, 'composer/composer.lock'), `${JSON.stringify(composerLock, null, 4)}\n`);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { 'template-dir': { type: 'string' } } });
  if (!values['template-dir']) throw new Error('--template-dir is required');
  writeLocks(ROOT, path.resolve(values['template-dir']));
  console.log(`release fixtures: wrote ${FIXTURES}/npm/package-lock.json and ${FIXTURES}/composer/composer.lock`);
}
