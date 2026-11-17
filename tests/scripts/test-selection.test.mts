// Tests that the three server test targets run a selection of unit test files of their package (H35.9-14, HR-84):
// PHP_TESTS of hyper-test-php, NODE_TESTS of hyper-test-node and PYTHON_TESTS of hyper-test-python. Each target is
// read by its dry run (HR-83): with a selection its recipe is the guard and the test runner of the target with the
// named files alone, and the results file is <runner>.files.txt, so <runner>.txt of a full run stays as it is. The
// guard is one shell command that starts no tool, so the tests run the line that the dry run printed: it fails for a
// path that names no file and when CASES is set too.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dryRun } from './make-dry-run.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// The target of each runner, its variable, its package, two test files of the package and the argument of the runner.
const TARGETS: readonly { target: string; variable: string; runner: string; directory: string; files: readonly [string, string]; starts: string }[] = [
  { target: 'hyper-test-php', variable: 'PHP_TESTS', runner: 'php', directory: 'packages/php', files: ['tests/CoreRulesTest.php', 'tests/CaseRunnerTest.php'], starts: 'phpunit --cwd packages/php ' },
  { target: 'hyper-test-node', variable: 'NODE_TESTS', runner: 'node', directory: 'packages/ts', files: ['tests/http.test.ts', 'tests/case-runner.test.ts'], starts: 'vitest --cwd packages/ts -- ' },
  { target: 'hyper-test-python', variable: 'PYTHON_TESTS', runner: 'python', directory: 'packages/python', files: ['tests/test_core_rules.py', 'tests/test_wsgi.py'], starts: ' python --venv ' },
];

/** The guard line and the runner lines of the recipe of `target` in a dry run with `variables`. */
function recipe(target: string, variables: string[]): { guard: string[]; runners: string[] } {
  const lines = dryRun(target, { variables });
  return { guard: lines.filter((line) => line.includes('names no test file')), runners: lines.filter((line) => line.includes('RECIPE_RESULTS=')) };
}

/** Runs one recipe line with the shell of make, in the repository root. */
function shell(line: string): { status: number | null; output: string } {
  const result = spawnSync('/bin/sh', ['-c', line], { cwd: ROOT, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

for (const { target, variable, runner, directory, files, starts } of TARGETS) {
  const selection = files.join(' ');

  test(`make ${target} ${variable}=... runs the named test files alone and writes ${runner}.files.txt`, () => {
    const { guard, runners } = recipe(target, [`${variable}=${selection}`]);
    assert.equal(guard.length, 1, `one line of make -n ${target} is the guard:\n${guard.join('\n')}`);
    const line = runners.join('\n');
    assert.ok(line.includes(starts), `the recipe starts the test runner of the target: ${line}`);
    assert.doesNotMatch(line, new RegExp(`/var/recipe/results/${runner}\\.txt|\\.selected\\.txt|RECIPE_CASES`, 'u'), line);
    assert.match(line, new RegExp(`RECIPE_RESULTS=\\S+/var/recipe/results/${runner}\\.files\\.txt `, 'u'), line);
    // No type check and no other test run follows the selected files.
    assert.doesNotMatch(line, /tsc|tests\/python_package|test_\*\.py/u, line);
    if (runner === 'python') {
      // unittest discovers one file by its name below its directory, so each file is a command of its own.
      for (const file of files) assert.ok(line.includes(`discover -s ${directory}/${path.dirname(file)} -t ${directory} -p ${path.basename(file)}`), `${file}: ${line}`);
    } else {
      assert.ok(line.endsWith(` -- ${selection}`), `the runner takes the paths as written: ${line}`);
    }
  });

  test(`the guard of make ${target} passes for files of the package and fails for a path that names none (HR-84)`, () => {
    for (const file of files) assert.ok(existsSync(path.join(ROOT, directory, file)), `${directory}/${file} is a test file of the package`);
    const present = recipe(target, [`${variable}=${selection}`]).guard[0] ?? '';
    assert.deepEqual(shell(present), { status: 0, output: '' }, present);

    const missing = `${files[0]} tests/no-such-test-file`;
    const absent = shell(recipe(target, [`${variable}=${missing}`]).guard[0] ?? '');
    assert.equal(absent.status, 1, absent.output);
    assert.equal(absent.output, `${target}: the selection ${variable}="${missing}" names no test file ${directory}/tests/no-such-test-file (HR-84)\n`);
  });

  test(`the guard of make ${target} fails when CASES and ${variable} are both set`, () => {
    const { guard, runners } = recipe(target, [`${variable}=${files[0]}`, 'CASES=reads.json']);
    const both = shell(guard[0] ?? '');
    assert.equal(both.status, 1, both.output);
    assert.equal(both.output, `${target}: CASES and ${variable} are both set: a run selects cases or test files, not both\n`);
    // The guard is the first of the two lines, so the runner does not start after it failed.
    assert.doesNotMatch(runners.join('\n'), /RECIPE_CASES/u);
  });

  test(`make ${target} with a blank ${variable} is the full run`, () => {
    const { guard, runners } = recipe(target, [`${variable}=  `]);
    assert.deepEqual(guard, []);
    assert.match(runners.join('\n'), new RegExp(`/var/recipe/results/${runner}\\.txt `, 'u'));
  });
}

test('make recipe-check gives no runner a selection of test files, whatever the variables hold', () => {
  const lines = dryRun('recipe-check', { variables: ['PHP_TESTS=tests/CoreRulesTest.php', 'NODE_TESTS=tests/http.test.ts', 'PYTHON_TESTS=tests/test_core_rules.py'] }).join('\n');
  assert.doesNotMatch(lines, /\.files\.txt|names no test file/u, lines);
});
