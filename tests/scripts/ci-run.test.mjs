// Tests the runner of the CI groups (HY-91, scripts/ci-run.mjs): it runs every target of a group with its own make to
// its end, also after a failed target, writes the record, the full log of each target and a summary with the status,
// the time and the first failure lines of each target, never stops for a report write that failed, refuses outside
// GitHub Actions, and gives the pins of the toolchain to the workflow.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ciPassed, ciRun, ciSummary, failureLines, pins } from '../../scripts/ci-run.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// A checkout with a Makefile whose target `bad` fails with an error line, `good` and `later` pass, and `noisy` fails
// without an error word.
function checkout(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'hyper-ci-run-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'Makefile'), [
    'good:', '\t@echo good ran',
    'bad:', '\t@echo first line', '\t@echo "error: the thing broke" >&2', '\t@printf "no final newline"', '\t@exit 3',
    'later:', '\t@echo later ran after a failure',
    'noisy:', '\t@echo just a line', '\t@false',
    '',
  ].join('\n'));
  mkdirSync(path.join(root, 'config'));
  writeFileSync(path.join(root, 'config/toolchain.json'), '{ "php": "8.5", "python": "3.14" }\n');
  for (const args of [['init', '--quiet'], ['add', '-A'], ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'fixture']]) {
    assert.equal(spawnSync('git', args, { cwd: root }).status, 0);
  }
  return root;
}

const quiet = () => {};

test('every target runs to its end after a failed target, and the report holds each status, time, log and failure line', async (t) => {
  const root = checkout(t);
  const status = await ciRun({ root, group: 'g', targets: ['bad', 'good', 'later', 'noisy'], env: { GITHUB_ACTIONS: 'true' }, print: quiet, output: quiet });
  assert.equal(status, 1);
  const report = path.join(root, 'var/ci/g');
  const record = JSON.parse(readFileSync(path.join(report, 'record.json'), 'utf8'));
  assert.equal(record.result, 'failed');
  assert.deepEqual(record.targets.map((target) => [target.name, target.status]), [['bad', 'failed'], ['good', 'passed'], ['later', 'passed'], ['noisy', 'failed']]);
  assert.ok(record.targets.every((target) => Number.isInteger(target.elapsedMs) && target.started && target.ended), JSON.stringify(record.targets));
  // The record names the run by its tree.
  assert.equal(record.tree, spawnSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).stdout.trim());
  assert.deepEqual(Object.keys(record).sort(), ['ended', 'environment', 'group', 'reportErrors', 'result', 'started', 'targets', 'tree']);
  assert.match(record.environment.node, /^v\d+/);
  const bad = record.targets[0];
  // make ends with status 2 for a failed recipe, whatever status the recipe ended with.
  assert.deepEqual(bad.failures, ['error: the thing broke', 'make bad exited with status 2']);
  // A target without a failure line of its own reports its last lines, among them the line in which make names the
  // failed recipe, whose form differs between make releases (HY-83).
  const noisy = record.targets[3].failures;
  assert.equal(noisy[0], 'just a line');
  assert.ok(noisy.some((line) => /\*\*\*.*noisy.*Error 1/.test(line)), noisy.join('\n'));
  assert.equal(noisy.at(-1), 'make noisy exited with status 2');
  assert.match(readFileSync(path.join(report, 'logs/bad.log'), 'utf8'), /^make --no-print-directory -k bad\n(.|\n)*first line\n(.|\n)*error: the thing broke\n(.|\n)*no final newline\n/);
  assert.match(readFileSync(path.join(report, 'logs/later.log'), 'utf8'), /later ran after a failure/);
  const summary = readFileSync(path.join(report, 'summary.md'), 'utf8');
  assert.match(summary, /2 passed, 2 failed, 0 not finished/);
  assert.match(summary, /^\| bad \| failed \| \d+\.\d s \| error: the thing broke \/ make bad exited with status 2 \|$/m);
  assert.match(summary, /^\| good \| passed \| \d+\.\d s \|  \|$/m);
  assert.match(summary, /^## bad\n\nlog: `logs\/bad\.log`\n\n```\nerror: the thing broke\nmake bad exited with status 2\n```$/m);
});

test('a report write that fails is recorded and stops no target', async (t) => {
  const root = checkout(t);
  mkdirSync(path.join(root, 'var/ci/g'), { recursive: true });
  // A file where the logs directory belongs makes every log write fail.
  writeFileSync(path.join(root, 'var/ci/g/logs'), 'not a directory');
  const printed = [];
  const status = await ciRun({ root, group: 'g', targets: ['good', 'later'], env: { GITHUB_ACTIONS: 'true' }, print: (line) => printed.push(line), output: quiet });
  assert.equal(status, 1);
  const record = JSON.parse(readFileSync(path.join(root, 'var/ci/g/record.json'), 'utf8'));
  assert.deepEqual(record.targets.map((target) => target.status), ['passed', 'passed']);
  assert.ok(record.reportErrors.some((error) => error.includes('logs/good.log')), JSON.stringify(record.reportErrors));
  assert.ok(printed.some((line) => line.includes('report write failed')), printed.join('\n'));
});

test('the runner refuses outside GitHub Actions and names make check', () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !['GITHUB_ACTIONS', 'MAKEFLAGS', 'MAKELEVEL', 'MFLAGS', 'MAKEOVERRIDES'].includes(name)));
  const run = spawnSync(process.execPath, ['scripts/ci-run.mjs', 'run', 'docs', 'docs-check'], { cwd: ROOT, encoding: 'utf8', env });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /runs only on GitHub Actions \(GITHUB_ACTIONS=true\); make check runs the full suite once per tree/);
  assert.equal(existsSync(path.join(ROOT, 'var/ci/docs/record.json')), false);
});

test('a group without targets fails with the Makefile variable that names them', async (t) => {
  const root = checkout(t);
  const lines = [];
  assert.equal(await ciRun({ root, group: 'none', targets: [], env: { GITHUB_ACTIONS: 'true' }, print: quiet, fail: (line) => lines.push(line), output: quiet }), 2);
  assert.match(lines.join('\n'), /CI group none has no targets; the Makefile names them in CI_TARGETS_none/);
});

test('the summary step writes the job summary, also for a run that recorded nothing or did not finish', async (t) => {
  const root = checkout(t);
  const stepSummary = path.join(root, 'step-summary.md');
  const steps = JSON.stringify({ install: { outcome: 'failure', conclusion: 'failure', outputs: {} }, pins: { outcome: 'success', conclusion: 'success', outputs: {} } });
  assert.equal(ciSummary({ root, group: 'g', env: { GITHUB_STEP_SUMMARY: stepSummary, CI_STEPS: steps }, print: quiet }), 0);
  const nothing = readFileSync(path.join(root, 'var/ci/g/summary.md'), 'utf8');
  assert.match(nothing, /make ci-check GROUP=g recorded no run/);
  assert.match(nothing, /^\| install \| failure \|$/m);
  assert.match(nothing, /the setup step install failed; its output is in the job log of that step/);
  assert.equal(readFileSync(stepSummary, 'utf8'), nothing);

  mkdirSync(path.join(root, 'var/ci/g'), { recursive: true });
  writeFileSync(path.join(root, 'var/ci/g/record.json'), JSON.stringify({ group: 'g', result: 'incomplete', tree: 't', started: 's', environment: {}, targets: [{ name: 'good', status: 'passed', elapsedMs: 1000, log: 'logs/good.log' }, { name: 'bad', status: 'running', log: 'logs/bad.log' }, { name: 'later', status: 'pending' }] }));
  ciSummary({ root, group: 'g', env: { GITHUB_STEP_SUMMARY: stepSummary }, print: quiet });
  const stopped = readFileSync(path.join(root, 'var/ci/g/summary.md'), 'utf8');
  assert.match(stopped, /The runner ended without recording the end of its run; bad was running/);
  assert.match(stopped, /1 passed, 0 failed, 2 not finished/);
});

test('the failure lines are the error lines in their order, else the last lines, then how make ended', () => {
  assert.deepEqual(failureLines(['ok', '[ 1.0s] ✔ node --test: 5 passed, 0 failed', 'not ok 2 - case', 'error TS2322: wrong', 'failed checks: lint;', 'make: *** [x] Error 1'], 'make x exited with status 2'), ['not ok 2 - case', 'error TS2322: wrong', 'failed checks: lint;', 'make x exited with status 2']);
  assert.deepEqual(failureLines(['a', 'b'], 'make x exited with status 2'), ['a', 'b', 'make x exited with status 2']);
  assert.equal(failureLines(Array.from({ length: 50 }, (_, index) => `Error ${index}`), 'end').length, 21);
});

// The output of make test-scripts in a CI run: a passing test prints a failed server start of its own, and
// the start lines of tests hold the words error and failure in their names.
test('the failure lines of a run with marked failures are the marked lines and their details, not start lines', () => {
  const lines = [
    '[    0.1s] ▶ tests/scripts/board-servers.test.mjs › a board whose server fails to start stops the servers',
    'FAIL start ssr (55 ms)',
    '[    0.2s] ✔ tests/scripts/board-servers.test.mjs › a board whose server fails to start stops the servers (0.2s)',
    '[    2.0s] ▶ tests/scripts/ci-run.test.mjs › the failure lines are the error lines in their order',
    '[    2.1s] ✖ tests/scripts/output-files.test.mjs › the server build writes the templates (0.0s)',
    '           Error: container cannot run: spawnSync container ENOENT',
    '[    2.1s] ✖ tests/scripts/output-files.test.mjs (0.0s)',
    '[    3.5s] ▶ tests/scripts/full-run.test.mjs › a make target resolves its result',
    '[    3.6s] ✖ tests/scripts/full-run.test.mjs › a make target resolves its result (0.1s)',
    '           AssertionError [ERR_ASSERTION]: line 7',
    '           line 8',
    '               at TestContext.<anonymous> (file:///full-run.test.mjs:305:10)',
    '[    3.7s] ✔ tests/scripts/full-run.test.mjs › another (0.0s)',
    '[   15.1s] ✖ node --test: 118 passed, 4 failed, 0 timed out, 0 skipped, 3 groups failed (15.1s)',
  ];
  assert.deepEqual(failureLines(lines, 'make test-scripts exited with status 2'), [
    '[    2.1s] ✖ tests/scripts/output-files.test.mjs › the server build writes the templates (0.0s)',
    '           Error: container cannot run: spawnSync container ENOENT',
    '[    2.1s] ✖ tests/scripts/output-files.test.mjs (0.0s)',
    '[    3.6s] ✖ tests/scripts/full-run.test.mjs › a make target resolves its result (0.1s)',
    '           AssertionError [ERR_ASSERTION]: line 7',
    '           line 8',
    '               at TestContext.<anonymous> (file:///full-run.test.mjs:305:10)',
    '[   15.1s] ✖ node --test: 118 passed, 4 failed, 0 timed out, 0 skipped, 3 groups failed (15.1s)',
    'make test-scripts exited with status 2',
  ]);
});

test('the pins give the PHP minor and the Python pin as step outputs', (t) => {
  const root = checkout(t);
  const output = path.join(root, 'output.txt');
  assert.deepEqual(pins({ root, env: { GITHUB_OUTPUT: output }, print: quiet }), { php: '8.5', python: '3.14' });
  assert.equal(readFileSync(output, 'utf8'), 'php=8.5\npython=3.14\n');
  const pinned = JSON.parse(readFileSync(path.join(ROOT, 'config/toolchain.json'), 'utf8'));
  assert.deepEqual(pins({ root: ROOT, env: {}, print: quiet }), { php: pinned.php, python: pinned.python });
});

test('a warning line of a passing target is recorded and named in the summary', async (t) => {
  const root = checkout(t);
  writeFileSync(path.join(root, 'Makefile'), 'measure:\n\t@echo "ok ssrScript: gzip 10"\n\t@echo "WARNING csrShell x: gzip 20 bytes exceed the limit 10 of config"\n');
  const status = await ciRun({ root, group: 'g', targets: ['measure'], env: { GITHUB_ACTIONS: 'true' }, print: quiet, output: quiet });
  assert.equal(status, 0);
  const record = JSON.parse(readFileSync(path.join(root, 'var/ci/g/record.json'), 'utf8'));
  assert.deepEqual(record.targets[0].warnings, ['WARNING csrShell x: gzip 20 bytes exceed the limit 10 of config']);
  const summary = readFileSync(path.join(root, 'var/ci/g/summary.md'), 'utf8');
  assert.match(summary, /1 passed, 0 failed, 0 not finished, 1 warning\./);
  assert.match(summary, /^## warnings\n\n- measure: WARNING csrShell x: gzip 20 bytes exceed the limit 10 of config$/m);
});

// The JSON of `needs` that GitHub writes into the step of the job ci-passed: one entry per needed job with its result.
const needs = (result) => `{\n  "check": {\n    "result": "${result}",\n    "outputs": {}\n  }\n}`;
const passed = (text) => {
  const lines = [];
  return { status: ciPassed({ text, print: (line) => lines.push(line) }), output: lines.join('\n') };
};

test('ci-passed passes when every needed job has the result success', () => {
  const { status, output } = passed(needs('success'));
  assert.equal(status, 0, output);
  assert.match(output, /^\[ci-passed\] check: success$/m);
  assert.match(output, /^\[ci-passed\] every needed job passed: check$/m);
});

test('ci-passed fails for a failed, skipped or cancelled job and names it with its result', () => {
  for (const result of ['failure', 'skipped', 'cancelled']) {
    const { status, output } = passed(JSON.stringify({ check: { result: 'success', outputs: {} }, other: { result, outputs: {} } }));
    assert.equal(status, 1, output);
    assert.match(output, new RegExp(`\\[ci-passed\\] failed: other \\(${result}\\); every needed job must have the result success`));
  }
});

test('ci-passed fails for results that are unset, not JSON or name no job, naming the cause', () => {
  for (const [text, cause] of [[undefined, 'RESULTS is not set'], ['', 'RESULTS is not JSON'], ['{', 'RESULTS is not JSON'], ['{}', 'RESULTS names no job'], ['[]', 'RESULTS names no job'], ['{"check": "success"}', 'check: no result']]) {
    const { status, output } = passed(text);
    assert.equal(status, 1, output);
    assert.ok(output.includes(cause), `${JSON.stringify(text)}: ${output}`);
  }
});

test('make ci-passed reads the multi-line JSON of needs from its command line', () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL', 'MAKEOVERRIDES', 'RESULTS'].includes(name)));
  for (const [result, status] of [['success', 0], ['failure', 2]]) {
    const ran = spawnSync('make', ['--no-print-directory', 'ci-passed', `RESULTS=${needs(result)}`], { cwd: ROOT, env, encoding: 'utf8' });
    assert.equal(ran.status, status, ran.stdout + ran.stderr);
    assert.match(ran.stdout, new RegExp(`\\[ci-passed\\] check: ${result}`));
  }
});
