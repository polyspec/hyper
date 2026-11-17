// Tests that the four targets of the case runners give the selection of the make variable CASES to their runner
// (H35.9-11, HR-84). Each target is read by its dry run (HR-83): with a selection its recipe starts the case runner
// alone, with the selection in RECIPE_CASES and with the results file <runner>.selected.txt, so the file <runner>.txt
// of a full run, which recipe-check reads, stays as it is; without one it starts the full run. recipe-check gives its
// runners no selection.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dryRun } from './make-dry-run.mts';

const SELECTION = 'reads.json app.json#opens a_case';

// The target of each runner, the name of its results file and the argument that starts the case runner alone.
const TARGETS: readonly { target: string; runner: string; alone: string }[] = [
  { target: 'hyper-test-php', runner: 'php', alone: '--cwd packages/php ' },
  { target: 'hyper-test-node', runner: 'node', alone: '--cwd packages/ts -- tests/case-runner.test.ts' },
  { target: 'hyper-test-python', runner: 'python', alone: '-p test_case_runner.py' },
  { target: 'hyper-test-js', runner: 'browser', alone: '--cwd packages/client -- tests/case-runner.test.ts' },
];

/** The command lines of a dry run that name a results file of the case runners. */
function runnerLines(target: string, variables: string[]): string[] {
  return dryRun(target, { variables }).filter((line) => line.includes('RECIPE_RESULTS='));
}

for (const { target, runner, alone } of TARGETS) {
  test(`make ${target} CASES=... starts the case runner alone with the selection and the selected results file`, () => {
    const lines = runnerLines(target, [`CASES=${SELECTION}`]);
    assert.equal(lines.length, 1, `one command of make -n ${target} names a results file:\n${lines.join('\n')}`);
    const line = lines[0] ?? '';
    assert.ok(line.includes(`RECIPE_CASES='${SELECTION}' `), line);
    assert.match(line, new RegExp(`RECIPE_RESULTS=\\S+/var/recipe/results/${runner}\\.selected\\.txt `, 'u'), line);
    assert.ok(line.includes(alone), `the command starts the case runner: ${line}`);
    if (runner === 'php') assert.ok(line.endsWith('-- --filter CaseRunnerTest'), line);
    // The selected run is one command: no type check and no second test run follows it.
    assert.doesNotMatch(line, /tsc|tests\/python_package|failed checks/u, line);
  });

  test(`make ${target} without CASES starts the full run with the results file of the runner`, () => {
    for (const variables of [[], ['CASES=  ']]) {
      const lines = runnerLines(target, variables);
      assert.equal(lines.length, 1, lines.join('\n'));
      const line = lines[0] ?? '';
      assert.doesNotMatch(line, /RECIPE_CASES|\.selected\.txt/u, line);
      assert.match(line, new RegExp(`RECIPE_RESULTS=\\S+/var/recipe/results/${runner}\\.txt `, 'u'), line);
    }
  });
}

test('make recipe-check CASES=... gives no runner a selection and names the results files of the full runs', () => {
  const lines = runnerLines('recipe-check', [`CASES=${SELECTION}`]).join('\n');
  assert.doesNotMatch(lines, /RECIPE_CASES|\.selected\.txt/u, lines);
  for (const runner of ['php', 'node', 'python', 'browser', 'build']) {
    assert.ok(lines.includes(`/var/recipe/results/${runner}.txt `), `recipe-check reads ${runner}.txt:\n${lines}`);
  }
});
