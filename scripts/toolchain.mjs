#!/usr/bin/env node
// The toolchain of the repository (HY-81). Every tool that builds or checks is pinned in a tracked file:
//   Node.js    .node-version
//   npm        `packageManager` of package.json, npm@<version>+sha512.<hex digest of the release tarball>
//   Composer   config/toolchain.json, `composer` with its version and the SHA-256 of composer.phar
//   PHP, make  config/toolchain.json, `php` and `make`
//   Rust       rust-toolchain.toml of the template branch (HY-80), which the declared copy holds
// npm and Composer are installed into this checkout, below the ignored directory var/tools, and never into the
// machine: a global tool is shared by every checkout and session of the machine, and an install of one replaces the
// tool of the others. var/tools/bin holds the commands `npm`, `npx` and `composer`, which run the installed releases;
// the Makefile puts var/tools/bin first on PATH, and scripts/run-tests.mjs does so for the tools that it starts.
//
//   node scripts/toolchain.mjs install         install the pinned npm and Composer into var/tools; a release that
//                                             is already installed is kept. The download is verified by its digest.
//   node scripts/toolchain.mjs check <make>    fail when a running tool is not the pinned one, naming the expected
//                                             and the actual version or path; <make> is $(MAKE_VERSION)
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TOOLS = path.join(ROOT, 'var', 'tools');
export const BIN = path.join(TOOLS, 'bin');

/** The pinned versions and digests of the tools. */
export function pins(root = ROOT) {
  const node = readFileSync(path.join(root, '.node-version'), 'utf8').trim();
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const npm = /^npm@(\d+\.\d+\.\d+)\+sha512\.([0-9a-f]{128})$/.exec(manifest.packageManager ?? '');
  if (!npm) throw new Error(`package.json must record packageManager as npm@<major>.<minor>.<patch>+sha512.<128 hexadecimal digits>; it records ${JSON.stringify(manifest.packageManager)}`);
  const config = JSON.parse(readFileSync(path.join(root, 'config', 'toolchain.json'), 'utf8'));
  return { node, npm: { version: npm[1], sha512: npm[2] }, ...config };
}

/** PATH with the tools of this checkout first. */
export function toolPath(current = process.env.PATH ?? '') {
  return [BIN, ...current.split(path.delimiter).filter((entry) => entry !== BIN)].join(path.delimiter);
}

const digest = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');

// Replaces the directory `target` with `next`: the old directory moves aside with one rename, the new one takes its
// place with another, so a reader finds a complete tool at every moment except between the two renames.
function publish(next, target) {
  const old = `${target}.old-${process.pid}`;
  if (existsSync(target)) renameSync(target, old);
  renameSync(next, target);
  rmSync(old, { recursive: true, force: true });
}

/** Downloads `url` and returns its bytes when their digest is `expected`; fails with the expected and the actual digest. */
export async function verifiedDownload(url, algorithm, expected) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`the download of ${url} answered ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = digest(algorithm, bytes);
  if (actual !== expected) throw new Error(`${url} has the ${algorithm} digest ${actual}, expected the pinned ${expected}`);
  return bytes;
}

async function installNpm({ version, sha512 }) {
  const target = path.join(TOOLS, 'npm');
  const installed = path.join(target, 'package.json');
  if (existsSync(installed) && JSON.parse(readFileSync(installed, 'utf8')).version === version && readFileSync(path.join(target, '.sha512'), 'utf8').trim() === sha512) {
    console.log(`toolchain: npm ${version} is installed in ${path.relative(ROOT, target)}`);
    return;
  }
  console.log(`toolchain: downloading npm ${version}`);
  const scratch = mkdtempSync(path.join(TOOLS, '.npm-'));
  try {
    const tarball = await verifiedDownload(`https://registry.npmjs.org/npm/-/npm-${version}.tgz`, 'sha512', sha512);
    writeFileSync(path.join(scratch, 'npm.tgz'), tarball);
    const next = path.join(scratch, 'npm');
    mkdirSync(next);
    execFileSync('tar', ['-x', '-f', path.join(scratch, 'npm.tgz'), '-C', next, '--strip-components', '1']);
    writeFileSync(path.join(next, '.sha512'), `${sha512}\n`);
    publish(next, target);
    console.log(`toolchain: installed npm ${version} in ${path.relative(ROOT, target)}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function installComposer({ version, sha256 }) {
  const target = path.join(TOOLS, 'composer');
  const phar = path.join(target, 'composer.phar');
  if (existsSync(phar) && digest('sha256', readFileSync(phar)) === sha256) {
    console.log(`toolchain: Composer ${version} is installed in ${path.relative(ROOT, target)}`);
    return;
  }
  console.log(`toolchain: downloading Composer ${version}`);
  const bytes = await verifiedDownload(`https://getcomposer.org/download/${version}/composer.phar`, 'sha256', sha256);
  const scratch = mkdtempSync(path.join(TOOLS, '.composer-'));
  try {
    const next = path.join(scratch, 'composer');
    mkdirSync(next);
    writeFileSync(path.join(next, 'composer.phar'), bytes);
    publish(next, target);
    console.log(`toolchain: installed Composer ${version} in ${path.relative(ROOT, target)}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// The commands of var/tools/bin, each written next to its path and moved into place with one rename.
const COMMANDS = {
  npm: '#!/bin/sh\nexec node "$(dirname "$0")/../npm/bin/npm-cli.js" "$@"\n',
  npx: '#!/bin/sh\nexec node "$(dirname "$0")/../npm/bin/npx-cli.js" "$@"\n',
  composer: '#!/bin/sh\nexec php "$(dirname "$0")/../composer/composer.phar" "$@"\n',
};

function writeCommands() {
  mkdirSync(BIN, { recursive: true });
  for (const [name, text] of Object.entries(COMMANDS)) {
    const file = path.join(BIN, name);
    if (existsSync(file) && readFileSync(file, 'utf8') === text) continue;
    writeFileSync(`${file}.${process.pid}`, text, { mode: 0o755 });
    renameSync(`${file}.${process.pid}`, file);
  }
  console.log(`toolchain: ${Object.keys(COMMANDS).join(', ')} in ${path.relative(ROOT, BIN)}`);
}

const output = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', env: { ...process.env, PATH: toolPath() } });
  if (result.error) return { error: `${command} cannot run: ${result.error.message}` };
  if (result.status !== 0) return { error: `${command} ${args.join(' ')} exited with ${result.status}: ${`${result.stdout}${result.stderr}`.trim()}` };
  return { text: result.stdout.trim() };
};

/** The tools that differ from their pins, each with the expected and the actual value. */
export function problems({ pinned = pins(), make }) {
  const found = [];
  const expect = (tool, expected, actual) => {
    if (actual !== expected) found.push(`${tool}: expected ${expected}, actual ${actual}`);
  };
  expect('Node.js', `v${pinned.node}`, process.version);
  const which = output('/usr/bin/which', ['npm']);
  expect('npm on PATH', path.join(BIN, 'npm'), which.error ?? which.text);
  const npm = output('npm', ['--version']);
  expect('npm', pinned.npm.version, npm.error ?? npm.text);
  const php = output('php', ['-r', 'echo PHP_VERSION;']);
  expect('PHP', pinned.php, php.error ?? php.text);
  const composerPath = output('/usr/bin/which', ['composer']);
  expect('Composer on PATH', path.join(BIN, 'composer'), composerPath.error ?? composerPath.text);
  const phar = path.join(TOOLS, 'composer', 'composer.phar');
  expect('Composer', pinned.composer.sha256, existsSync(phar) ? digest('sha256', readFileSync(phar)) : `no ${path.relative(ROOT, phar)}`);
  if (make !== undefined) expect('make', pinned.make, make);
  return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [action, make] = process.argv.slice(2);
  try {
    if (action === 'install') {
      const pinned = pins();
      mkdirSync(TOOLS, { recursive: true });
      await installNpm(pinned.npm);
      await installComposer(pinned.composer);
      writeCommands();
    } else if (action === 'check' && make !== undefined) {
      const found = problems({ make });
      if (found.length > 0) {
        process.stderr.write(`the toolchain differs from its pins (HY-81); \`make tools\` installs npm and Composer into var/tools:\n${found.map((line) => `  ${line}`).join('\n')}\n`);
        process.exitCode = 1;
      }
    } else {
      throw new Error('Usage: node scripts/toolchain.mjs install | check <make version>');
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
