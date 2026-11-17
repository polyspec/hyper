// Tests that a dry run of a recipe that starts make again runs no command (HR-83, H35.16-7). make executes a recipe line
// that names $(MAKE) under -n too, with every other command of that line, so that the make it starts prints its own
// commands. A line that holds $(MAKE) and another command therefore runs that command in a dry run, and a test that reads
// the target by `make -n` starts it. Each recipe line that names $(MAKE) is one make call and nothing else. Each test runs
// the Makefile in a directory of its own (HR-85).
import assert from 'node:assert/strict';
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
  // One make runs the runners and then the comparison, each to its end after a failed one (HR-86): -k, and -j1 for the order.
  assert.match(lines, /^\S*make --no-print-directory -k -j1 recipe-run-php recipe-run-node recipe-run-python recipe-run-browser recipe-run-build recipe-compare$/mu, lines);
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
