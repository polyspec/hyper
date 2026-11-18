// Tests that a dry run of a recipe that starts make again runs no command (HR-83, H35.16-7). make executes a recipe line
// that names $(MAKE) under -n too, with every other command of that line, so that the make it starts prints its own
// commands. A line that holds $(MAKE) and another command therefore runs that command in a dry run, and a test that reads
// the target by `make -n` starts it. Each recipe line that names $(MAKE) is one make call and nothing else. Each test runs
// the Makefile in a directory of its own (HR-85).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dryRun } from './make-dry-run.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAKEFILE = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');

/**
 * A directory with the Makefile of the checkout and a program `node` that records each start in the file `started`.
 * Returns the directory, the variable that gives make that program as NODE, and the starts that it recorded.
 */
function tree(t: TestContext): { directory: string; variables: string[]; started: () => string } {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-make-recursion-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  copyFileSync(path.join(ROOT, 'Makefile'), path.join(directory, 'Makefile'));
  const node = path.join(directory, 'node');
  const record = path.join(directory, 'started');
  writeFileSync(node, ['#!/bin/sh', `printf '%s\\n' "$*" >> '${record}'`, ''].join('\n'));
  chmodSync(node, 0o755);
  return { directory, variables: [`NODE=${node}`], started: () => (existsSync(record) ? readFileSync(record, 'utf8') : '') };
}

test('a dry run of recipe-check prints the case runners and the check and starts none of them (H35.16-7)', (t) => {
  const { directory, variables, started } = tree(t);
  const lines = dryRun('recipe-check', { cwd: directory, variables }).join('\n');
  assert.equal(started(), '', 'make -n recipe-check started a command of its recipe');
  // The checks are the commands of the runners and of the comparison, and no make (HR-86): they end with the line that
  // names the failed ones.
  assert.doesNotMatch(lines, /(?:^|[\s;])\S*make (?:-|recipe-)/mu, lines);
  assert.ok(lines.includes('echo "failed checks:$failed"'), lines);
  // The dry run prints what the target runs: the five case runners and the check that reads their results (HR-84).
  for (const part of ['--filter CaseRunnerTest', `--cwd packages/ts -- tests/case-runner.test.ts`, 'test_case_runner.py', `--cwd packages/client -- tests/case-runner.test.ts`, 'tests/scripts/build-id.test.mts', 'scripts/recipe/check.mts --root .']) {
    assert.ok(lines.includes(part), `make -n recipe-check prints "${part}":\n${lines}`);
  }
});

test('a dry run of install-tools prints the check of the PHP of the checkout with its condition and starts no command (H35.16-7)', (t) => {
  const { directory, variables, started } = tree(t);
  // A wrapper exists, so a condition that the recipe line of install-tools decided would start make php-check.
  mkdirSync(path.join(directory, 'var/tools/bin'), { recursive: true });
  writeFileSync(path.join(directory, 'var/tools/bin/php'), '');
  const lines = dryRun('install-tools', { cwd: directory, variables });
  assert.equal(started(), '', 'make -n install-tools started a command of its recipe');
  const check = lines.filter((line) => line.includes('php-check: '));
  assert.equal(check.length, 1, lines.join('\n'));
  assert.match(check[0] ?? '', /^test ! -e \S+\/var\/tools\/bin\/php \|\| \{ /u, 'the printed check holds the condition under which it starts PHP');
});

// The targets that write tracked files which their tools own (H35.8-3): Cargo.lock by cargo update, and the tracked
// binding packages, go.mod and go.sum among them, by binding scaffold.
test('a dry run of cargo-lock prints cargo update of the named crates through the tracked-lock form of the link script by absolute paths and starts nothing (H35.8-3, H35.8-5)', (t) => {
  const real = dryRun('cargo-lock', { variables: ['CRATES=polyspec-one polyspec-two'] });
  assert.match(real.at(-1) ?? '', /^env -u npm_config_offline -u COMPOSER_DISABLE_NETWORK \/\S+\/node \/\S+\/link\.m[jt]s cargo --tracked-lock \/\S+ update -p polyspec-one -p polyspec-two$/u, real.join('\n'));
  const { directory, variables, started } = tree(t);
  writeFileSync(path.join(directory, '.links'), '../provider\n');
  dryRun('cargo-lock', { cwd: directory, variables: [...variables, 'CRATES=polyspec-one'] });
  assert.equal(started(), '', 'make -n cargo-lock started a command of its recipe');
});

test('cargo-lock starts no cargo without CRATES, and starts the tracked-lock form in a checkout with and without .links (H35.8-3, H35.8-5)', (t) => {
  const { directory, variables, started } = tree(t);
  const make = (...more: string[]) => spawnSync('make', ['--no-print-directory', 'cargo-lock', ...variables, ...more], { cwd: directory, encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL', 'MAKEOVERRIDES'].includes(name))) });
  const empty = make();
  assert.notEqual(empty.status, 0, empty.stdout + empty.stderr);
  assert.match(empty.stderr, /cargo-lock: CRATES is empty/u);
  assert.equal(started(), '', 'cargo-lock started a command without CRATES');
  // With a link declaration the link script runs cargo without the patches and the copy of the lock (kit K1287), so
  // the recipe is the same with and without .links and refuses neither.
  writeFileSync(path.join(directory, '.links'), '../provider\n');
  const linked = make('CRATES=polyspec-one');
  assert.equal(linked.status, 0, linked.stdout + linked.stderr);
  assert.match(started(), /link\.m[jt]s cargo --tracked-lock \S+ update -p polyspec-one\n$/u);
  rmSync(path.join(directory, '.links'));
  const released = make('CRATES=polyspec-one polyspec-two');
  assert.equal(released.status, 0, released.stdout + released.stderr);
  assert.match(started(), /link\.m[jt]s cargo --tracked-lock \S+ update -p polyspec-one -p polyspec-two\n$/u);
});

test('a dry run of bindings-scaffold prints binding scaffold with the cargo of the link script by absolute paths and starts nothing (H35.8-3)', (t) => {
  const real = dryRun('bindings-scaffold');
  assert.match(real.at(-1) ?? '', /^env -u npm_config_offline -u COMPOSER_DISABLE_NETWORK \/\S+\/node \/\S+\/node_modules\/@polyspec\/binding\/dist\/cli\.js scaffold --root \/\S+ --cargo "\/\S+\/node \/\S+\/link\.m[jt]s cargo \/\S+"$/u, real.join('\n'));
  // The cases of the contract are written first, as for bindings-check, which compares with what scaffold writes.
  assert.ok(real.some((line) => line.includes('scripts/binding-cases.mts')), real.join('\n'));
  const { directory, variables, started } = tree(t);
  dryRun('bindings-scaffold', { cwd: directory, variables });
  assert.equal(started(), '', 'make -n bindings-scaffold started a command of its recipe');
});

// The locks of uv and of Composer have their targets too (H35.41): each starts the tool of the checkout by its absolute
// path with the offline settings lifted, since the tool downloads what it locks.
const ONLINE = 'env -u npm_config_offline -u COMPOSER_DISABLE_NETWORK';

test('a dry run of npm-lock prints npm install of the lock alone for the root and for tests/package-install by the absolute path of the npm of the checkout (H35.41)', () => {
  const npm = path.join(ROOT, 'var/tools/bin/npm');
  const lines = dryRun('npm-lock');
  // --package-lock-only installs nothing, and --ignore-scripts runs no script of a package; --prefix names the second
  // project, whose .npmrc npm then reads, as make install-packages names the project of the recipe reader.
  assert.deepEqual(lines.slice(-2), [
    `${ONLINE} ${npm} install --package-lock-only --ignore-scripts`,
    `${ONLINE} ${npm} install --package-lock-only --ignore-scripts --prefix tests/package-install`,
  ], lines.join('\n'));
});

test('a dry run of python-lock prints uv lock of the Python package by the absolute path of the uv of the checkout (H35.41)', () => {
  const lines = dryRun('python-lock');
  assert.equal(lines.at(-1), `${ONLINE} ${path.join(ROOT, 'var/tools/mise/shims/uv')} lock --project packages/python`, lines.join('\n'));
});

test('a dry run of composer-lock prints composer update of the named packages alone for both Composer roots, and fails without PACKAGES (H35.41)', () => {
  const composer = path.join(ROOT, 'var/tools/mise/shims/composer');
  const lines = dryRun('composer-lock', { variables: ['PACKAGES=vendor/one vendor/two'] });
  // Only the named packages move, with no install: an update of every package would resolve ranges at the time of the run (HR-89).
  assert.deepEqual(lines.slice(-2), [
    `${ONLINE} ${composer} update --no-install --no-interaction vendor/one vendor/two`,
    `${ONLINE} ${composer} update --no-install --no-interaction --working-dir=examples/board vendor/one vendor/two`,
  ], lines.join('\n'));
  // Without PACKAGES the recipe stops before it prints or starts a command, in a dry run too.
  for (const variables of [[], ['PACKAGES=']]) {
    const empty = spawnSync('make', ['--no-print-directory', '-n', 'composer-lock', ...variables], { cwd: ROOT, encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL', 'MAKEOVERRIDES'].includes(name))) });
    assert.notEqual(empty.status, 0, empty.stdout + empty.stderr);
    assert.match(empty.stderr, /composer-lock: PACKAGES is empty; name the packages whose pin changed: make composer-lock PACKAGES="<vendor\/package> <vendor\/package>"/u);
    assert.doesNotMatch(empty.stdout, /composer update/u);
  }
});

/** The recipe lines of the Makefile, each with its continuation lines. */
function recipeLines(): string[] {
  const found: string[] = [];
  // Whether the line before ends with a backslash, and whether the line that it continues is a recipe line: the
  // continuation lines of a variable start with a tab too.
  let open = false;
  let recipe = false;
  for (const line of MAKEFILE.split('\n')) {
    if (!open) {
      recipe = line.startsWith('\t');
      if (recipe) found.push(line);
    } else if (recipe) found[found.length - 1] += `\n${line}`;
    open = line.endsWith('\\');
  }
  return found;
}

// One make call: an optional @, the environment of $(ONLINE), $(MAKE) and its words, with no other command.
const ONE_MAKE = /^\t@?(?:\$\(ONLINE\) )?\$\(MAKE\)[^;&|\n]*$/u;

test('every recipe line that names $(MAKE) is one make call and holds no other command (H35.16-7)', () => {
  const lines = recipeLines().filter((line) => line.includes('$(MAKE)'));
  assert.ok(lines.length > 10, `the recipe lines that name $(MAKE) are found: ${lines.length}`);
  assert.deepEqual(lines.filter((line) => !ONE_MAKE.test(line)), []);
  // make reads the name $(MAKE) in a recipe line as the Makefile writes it, so a line that takes it from a variable is
  // printed in a dry run and not run, which the next test shows for ci_run, the call of a CI job. A new variable that
  // names $(MAKE) is stated here with the recipe that expands it.
  const variables = [...MAKEFILE.matchAll(/^(?:define )?(\w+)(?: :?=|$)(?:.*\\\n)*.*\$\(MAKE\)/gmu)].map((match) => match[1]);
  assert.deepEqual(variables, ['CI_MAKE', 'ci_run']);
});

test('a dry run of the call of a CI job prints the steps of the job and starts no command (HR-90, H35.16-7)', (t) => {
  const { directory, variables, started } = tree(t);
  const lines = dryRun('ci-check', { cwd: directory, variables: [...variables, 'NAME=docs'] }).join('\n');
  assert.equal(started(), '', 'make -n ci-check NAME=docs started a command of its recipe');
  assert.ok(lines.includes(' ci-targets TARGETS="') && lines.includes(' install-tools TOOLS="'), lines);
});
