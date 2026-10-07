#!/usr/bin/env node
// The consumer fixtures of the release assets (HY-95, HY-89): tests/release-install/npm holds a package.json that
// depends on the release tarballs of this repository by `file:` and on the tarball of the template release by its URL,
// and its package-lock.json; tests/release-install/composer holds a composer.json with an `artifact` repository of the
// release zips of this repository and a `package` repository of the zip of the template release, and its
// composer.lock. The test tests/scripts/release-install.test.mjs installs them in a temporary directory outside the
// repository with `npm ci` and `composer install`; `make release-fixtures` writes the locks.
//
//   node scripts/release-fixtures.mjs
//
// The assets are the archives of `buildAssets` at the version of packages/hyper-js/package.json. The npm lock pins
// every package that it downloads, third-party packages and the template tarball, with its exact version and
// integrity, and the Composer lock pins the template zip with its shasum; a package of this repository is a local
// archive of the same run, so its lock entry names the file without an integrity or a shasum. The locks change when a
// release version or a dependency changes, never with the content of an archive of this repository.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildAssets } from './release.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURES = 'tests/release-install';
// A registry address that refuses every connection: port 9 of the loopback address. The scope @polyspec points at
// it, so a polyspec package comes only from its tarball.
// The npm settings of a consumer install: a URL dependency of the root package.json is allowed, which npm 12 refuses by
// default (allow-remote).
export const NPM_CONSUMER = ['--allow-remote=root'];
// The npm setting of the lock write only (H13.5-14): npm 12.2.0 counts the registry tarball of a package with
// `bundleDependencies`, here `@tailwindcss/oxide-wasm32-wasi` below `@polyspec/hyper-build`, as a remote package
// while it builds a lock and refuses it under `allow-remote=root` with EALLOWREMOTE
// (https://github.com/npm/cli/pull/9818). npm has no allow list of URLs, so the lock write allows every remote
// package; `npm ci` of the fixture keeps NPM_CONSUMER and installs only what the lock pins by its integrity.
// Remove this setting when the npm release that `packageManager` pins contains npm/cli#9818.
export const NPM_LOCK_WRITE = ['--allow-remote=all'];
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

/** The release archives of this repository in `folder/assets`, their version and the template version they require. */
export function stageAssets(root, folder) {
  const manifest = JSON.parse(readFileSync(path.join(root, 'packages/hyper-js/package.json'), 'utf8'));
  const assets = path.join(folder, 'assets');
  const commit = run('git', ['rev-parse', 'HEAD'], { cwd: root }).trim();
  buildAssets(root, commit, `v${manifest.version}`, assets);
  return { version: manifest.version, template: manifest.dependencies['@polyspec/template'], assets };
}

/** The npm consumer: the fixture and every local tarball that its package.json names, in `folder/npm`. */
export function npmProject(root, folder, assets, { lock = true } = {}) {
  const project = path.join(folder, 'npm');
  mkdirSync(project, { recursive: true });
  const manifest = JSON.parse(readFileSync(path.join(root, FIXTURES, 'npm/package.json'), 'utf8'));
  writeFileSync(path.join(project, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (lock) cpSync(path.join(root, FIXTURES, 'npm/package-lock.json'), path.join(project, 'package-lock.json'));
  for (const spec of Object.values(manifest.dependencies).filter((value) => value.startsWith('file:'))) {
    const file = spec.replace(/^file:/, '');
    if (!existsSync(path.join(assets, file))) throw new Error(`${FIXTURES}/npm/package.json names ${file}, which is not a built asset; the release versions changed, run make release-fixtures`);
    cpSync(path.join(assets, file), path.join(project, file));
  }
  return project;
}

/** The Composer consumer: the fixture and the zips of this repository in its artifact repository `folder/composer/assets`. */
export function composerProject(root, folder, assets, { lock = true } = {}) {
  const project = path.join(folder, 'composer');
  mkdirSync(path.join(project, 'assets'), { recursive: true });
  cpSync(path.join(root, FIXTURES, 'composer/composer.json'), path.join(project, 'composer.json'));
  if (lock) cpSync(path.join(root, FIXTURES, 'composer/composer.lock'), path.join(project, 'composer.lock'));
  for (const file of readdirSync(assets).filter((name) => name.endsWith('.zip'))) cpSync(path.join(assets, file), path.join(project, 'assets', file));
  return project;
}

/** Write the locks of both fixtures from the assets of the tree. */
export function writeLocks(root) {
  const folder = outside();
  try {
    const { assets } = stageAssets(root, folder);
    const npm = npmProject(root, folder, assets, { lock: false });
    run('npm', ['install', '--package-lock-only', `--cache=${path.join(folder, 'npm-cache')}`, `--@polyspec:registry=${UNREACHABLE}`, '--fetch-retries=0', ...NPM_LOCK_WRITE, '--no-audit', '--no-fund'], { cwd: npm, env: consumerEnv() });
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
  writeLocks(ROOT);
  console.log(`release fixtures: wrote ${FIXTURES}/npm/package-lock.json and ${FIXTURES}/composer/composer.lock`);
}
