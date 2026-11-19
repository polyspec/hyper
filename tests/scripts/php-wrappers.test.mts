// Tests the choice of the PHP that make install-tools wraps (H35.137): scripts/php-wrappers.mts prints the absolute path
// of the php of the minor release in .php-version under the Homebrew prefixes, whatever the order of PATH, and fails
// when no such php exists. A machine without Homebrew, such as a CI runner whose PHP a setup step installs on PATH, has
// its php found in the directories of PATH, where a php of another minor release is passed over (H35.153). With
// --if-present the script prints nothing and exits 0 when no such php exists, so install-tools installs the tools of a
// group that runs no PHP (H35.153). Each test writes its prefixes in a directory of its own (HR-85).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts/php-wrappers.mts');
const MAKEFILE = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
const PINNED = readFileSync(path.join(ROOT, '.php-version'), 'utf8').trim();
const OTHER = `${PINNED.split('.')[0] ?? ''}.${Number(PINNED.split('.')[1]) + 1}`;

/** A directory of its own that holds the prefixes of a test, removed when the test ends. */
function prefix(t: TestContext): string {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'hyper-php-wrappers-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** Writes `<prefix>/opt/<formula>/bin/php` as a php that reports the minor release `minor` to the version query. */
function php(root: string, formula: string, minor: string): void {
  const file = path.join(root, 'opt', formula, 'bin/php');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, ['#!/bin/sh', `printf '%s' '${minor}'`, ''].join('\n'));
  chmodSync(file, 0o755);
}

/**
 * Runs the script with the arguments and a PATH of one directory of the test that holds no php, so the test states
 * every place where the script may find a php: a php of the machine, such as /usr/bin/php, is not one of them.
 */
function run(root: string, ...args: string[]): { status: number | null; stdout: string; stderr: string } {
  return runWithPath(path.join(root, 'no-php'), ...args);
}

/** Runs the script with the arguments and the given PATH. */
function runWithPath(searchPath: string, ...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { PATH: searchPath } });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Writes `<directory>/php` as a php that reports the minor release `minor` to the version query, and returns the file. */
function phpOnPath(directory: string, minor: string): string {
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'php');
  writeFileSync(file, ['#!/bin/sh', `printf '%s' '${minor}'`, ''].join('\n'));
  chmodSync(file, 0o755);
  return file;
}

test('path prints the php of the pinned minor release, even when another minor release comes first on PATH (H35.137)', (t) => {
  const root = prefix(t);
  php(root, `php@${PINNED}`, PINNED);
  php(root, 'php', OTHER);
  const result = run(root, 'path', PINNED, `--prefix=${root}`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), path.join(root, 'opt', `php@${PINNED}`, 'bin/php'));
});

test('path fails and names the minor release and the prefixes it searched when no php of that minor release exists (H35.137)', (t) => {
  const root = prefix(t);
  php(root, 'php', OTHER);
  const result = run(root, 'path', PINNED, `--prefix=${root}`);
  assert.notEqual(result.status, 0, result.stdout);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.includes(`php-wrappers: no php of PHP ${PINNED} exists`), result.stderr);
  assert.ok(result.stderr.includes(path.join(root, 'opt', `php@${PINNED}`, 'bin/php')), result.stderr);
});

test('path fails for a php whose version query does not report the minor release it is named for (H35.137)', (t) => {
  const root = prefix(t);
  php(root, `php@${PINNED}`, OTHER);
  const result = run(root, 'path', PINNED, `--prefix=${root}`);
  assert.notEqual(result.status, 0, result.stdout);
  assert.ok(result.stderr.includes(`php-wrappers: no php of PHP ${PINNED} exists`), result.stderr);
});

test('install-tools passes the php that the script chooses to kit as --php, and no recipe names a php from PATH (H35.137)', () => {
  const recipe = /^install-tools:[^\n]*\n((?:\t[^\n]*\n|ifeq[^\n]*\n|else\n|endif\n)*)/mu.exec(MAKEFILE)?.[1] ?? '';
  assert.match(recipe, /--php="\$\$php"/u, recipe);
  assert.match(recipe, /php-wrappers\.mts path "\$\$minor"/u, recipe);
  assert.match(recipe, /minor="\$\$\(tr -d '\[:space:\]' < \.php-version\)"/u, recipe);
});

test('path finds the php of the pinned minor release in PATH when no prefix holds one, past a php of another minor release earlier on PATH (H35.153)', (t) => {
  const root = prefix(t);
  phpOnPath(path.join(root, 'other'), OTHER);
  const pinned = phpOnPath(path.join(root, 'pinned'), PINNED);
  const searchPath = [path.join(root, 'other'), path.join(root, 'pinned')].join(path.delimiter);
  const result = runWithPath(searchPath, 'path', PINNED, `--prefix=${path.join(root, 'empty')}`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), pinned);
});

test('path --if-present prints nothing and exits 0 when no php of the pinned minor release exists (H35.153)', (t) => {
  const root = prefix(t);
  phpOnPath(path.join(root, 'other'), OTHER);
  const searchPath = [path.join(root, 'other')].join(path.delimiter);
  const result = runWithPath(searchPath, 'path', PINNED, '--if-present', `--prefix=${path.join(root, 'empty')}`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('install-tools asks for the php only if present and passes --php only when the script printed one (H35.153)', () => {
  const recipe = /^install-tools:[^\n]*\n((?:\t[^\n]*\n|ifeq[^\n]*\n|else\n|endif\n)*)/mu.exec(MAKEFILE)?.[1] ?? '';
  assert.match(recipe, /php-wrappers\.mts path "\$\$minor" --if-present/u, recipe);
  assert.match(recipe, /\$\$\{php:\+--php="\$\$php"\}/u, recipe);
});
