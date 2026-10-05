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

import { ciRun, ciSummary, failureLines, pins } from '../../scripts/ci-run.mjs';

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
  writeFileSync(path.join(root, 'config/template.json'), '{ "branch": "main" }\n');
  writeFileSync(path.join(root, 'config/toolchain.json'), '{ "php": "8.5" }\n');
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
  assert.equal(record.template, 'main');
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
  writeFileSync(path.join(root, 'var/ci/g/record.json'), JSON.stringify({ group: 'g', result: 'incomplete', commit: 'c', tree: 't', template: 'p', started: 's', environment: {}, targets: [{ name: 'good', status: 'passed', elapsedMs: 1000, log: 'logs/good.log' }, { name: 'bad', status: 'running', log: 'logs/bad.log' }, { name: 'later', status: 'pending' }] }));
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

test('pins gives the PHP minor and the template branch as step outputs', (t) => {
  const root = checkout(t);
  const output = path.join(root, 'output.txt');
  assert.deepEqual(pins({ root, env: { GITHUB_OUTPUT: output }, print: quiet }), { php: '8.5', template: 'main' });
  assert.equal(readFileSync(output, 'utf8'), 'php=8.5\ntemplate=main\n');
  assert.deepEqual(pins({ root: ROOT, env: {}, print: quiet }), { php: JSON.parse(readFileSync(path.join(ROOT, 'config/toolchain.json'), 'utf8')).php, template: JSON.parse(readFileSync(path.join(ROOT, 'config/template.json'), 'utf8')).branch });
});
