// Tests the rules of the GitHub workflows (HY-86, HY-90): every job runs on the declared runner ubuntu-26.04-arm, every
// action is pinned by its commit, no step or job has a time limit, every step after the first of a job runs after a
// failed step (`if: ${{ !cancelled() }}`), except in the jobs whose every step needs the earlier one (STOPPING), and
// every step that runs a command runs one make target, so the exported settings and the checks of the Makefile, such
// as the offline settings and the toolchain check, apply to it. The last job of ci.yml is ci-passed, the check of ci.yml
// that the ruleset main requires (HY-94): it runs after every other job (`if: ${{ always() }}`), needs every other job
// of the workflow, runs on their runner and runs `make ci-passed` with the JSON of `needs`.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { dryRun } from './make-dry-run.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOWS = path.join(ROOT, '.github/workflows');
const RUNNER = 'ubuntu-26.04-arm';
// The jobs whose every step needs the one before it, so a failed step stops the job: ci-passed reports the results of
// the other jobs of ci.yml, and each step of release reads what the step before it checked or built.
const STOPPING = { 'ci.yml': ['ci-passed'], 'release.yml': ['release'] };
const CI_PASSED = 'ci-passed';
const CI_PASSED_RUN = "make ci-passed RESULTS='${{ toJSON(needs) }}'";

/**
 * The jobs of a workflow file, read from the block layout that the workflows of this repository use: a job is a key
 * at indent 2 below `jobs:`, a step is an item `- ` at indent 6 below its `steps:`. Returns
 * [{ name, text, steps: [{ text, run, uses, if }] }].
 */
function jobs(text) {
  const lines = text.split('\n');
  const start = lines.indexOf('jobs:');
  assert.ok(start >= 0, 'the workflow has no jobs: line');
  const found = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const job = /^ {2}([\w-]+):$/.exec(line);
    if (job) {
      found.push({ name: job[1], lines: [], steps: [] });
      continue;
    }
    const current = found.at(-1);
    if (!current) continue;
    current.lines.push(line);
    if (/^ {6}- /.test(line)) current.steps.push([line.replace(/^ {6}- /, '        ')]);
    else if (current.steps.length > 0 && /^ {8}/.test(line)) current.steps.at(-1).push(line);
  }
  const value = (step, key) => {
    const line = step.find((entry) => entry.startsWith(`        ${key}:`));
    return line === undefined ? undefined : line.slice(`        ${key}:`.length).trim();
  };
  return found.map((job) => ({
    name: job.name,
    text: job.lines.join('\n'),
    steps: job.steps.map((step) => ({ text: step.join('\n'), run: value(step, 'run'), uses: value(step, 'uses'), if: value(step, 'if') })),
  }));
}

const workflows = () => readdirSync(WORKFLOWS).filter((name) => name.endsWith('.yml')).map((name) => ({ name, text: readFileSync(path.join(WORKFLOWS, name), 'utf8') }));

test('the reader finds the jobs and the steps of a workflow', () => {
  const read = jobs('on:\n  push:\njobs:\n  first:\n    runs-on: x\n    steps:\n      - uses: a/b@c\n        with:\n          d: e\n      - run: make one\n        if: ${{ !cancelled() }}\n  second:\n    steps:\n      - id: s\n        run: make two\n');
  assert.deepEqual(read.map((job) => job.name), ['first', 'second']);
  assert.deepEqual(read[0].steps.map((step) => [step.uses, step.run, step.if]), [['a/b@c', undefined, undefined], [undefined, 'make one', '${{ !cancelled() }}']]);
  assert.equal(read[1].steps[0].run, 'make two');
});

test('every job runs on the declared runner without a time limit, and every action is pinned by its commit', () => {
  const found = [];
  for (const workflow of workflows()) {
    if (/timeout-minutes/.test(workflow.text)) found.push(`${workflow.name}: timeout-minutes`);
    for (const job of jobs(workflow.text)) {
      if (!new RegExp(`^ {4}runs-on: ${RUNNER}$`, 'm').test(job.text)) found.push(`${workflow.name} ${job.name}: runs-on is not ${RUNNER}`);
      for (const step of job.steps.filter((entry) => entry.uses)) {
        if (!/^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d/.test(step.uses)) found.push(`${workflow.name} ${job.name}: ${step.uses} is not pinned by a commit with its release`);
      }
    }
  }
  assert.deepEqual(found, []);
});

test('every step that runs a command runs make, and every step after the first runs after a failed step (HY-86)', () => {
  const found = [];
  for (const workflow of workflows()) {
    for (const job of jobs(workflow.text)) {
      assert.ok(job.steps.length > 0, `${workflow.name} ${job.name} has no step`);
      job.steps.forEach((step, index) => {
        if (step.run !== undefined && !/^make [^|&;<>`$\n]*(\$\{\{ [^}]+ \}\}[^|&;<>`$\n]*)*$/.test(step.run)) found.push(`${workflow.name} ${job.name}: the step "${step.run}" runs a command other than one make`);
        if (index > 0 && !(STOPPING[workflow.name] ?? []).includes(job.name) && !(step.if ?? '').includes('!cancelled()')) found.push(`${workflow.name} ${job.name}: step ${index + 1} runs only while every earlier step passed`);
      });
    }
  }
  assert.deepEqual(found, []);
});

// The on: block of each workflow, exactly: the checks run on every pull request, every merge group and every manual run;
// the push gate also on every push to a branch outside the merge queue. No other workflow exists (HY-91, HY-94).
const TRIGGERS = {
  'ci.yml': 'on:\n  pull_request:\n  merge_group:\n  workflow_dispatch:\n',
  'push-gate.yml': "on:\n  push:\n    branches-ignore: ['gh-readonly-queue/**']\n  pull_request:\n  merge_group:\n",
};

test('each workflow declares exactly its triggers (HY-91, HY-94)', () => {
  assert.deepEqual(workflows().map(workflow => workflow.name).sort(), Object.keys(TRIGGERS).sort());
  for (const workflow of workflows()) {
    const declared = /^(on:\n(?: {2}.*\n)+)/m.exec(workflow.text)?.[1] ?? '';
    assert.equal(declared, TRIGGERS[workflow.name], `${workflow.name} declares other triggers`);
  }
});

test('every workflow runs on pull requests and merge groups, and a push trigger skips the branches of the queue (HY-94)', () => {
  const found = [];
  for (const workflow of workflows()) {
    const trigger = /^on:\n((?: {2}.*\n)+)/m.exec(workflow.text)?.[1] ?? '';
    const events = [...trigger.matchAll(/^ {2}([\w-]+):/gm)].map(match => match[1]);
    // The ruleset main requires the checks of every workflow, and the merge queue runs them on the merge group.
    if (!events.includes('pull_request') || !events.includes('merge_group')) found.push(`${workflow.name}: runs on ${events.join(', ')}, not on pull_request and merge_group`);
    // A push to a branch of the merge queue would run the checks of the merge group a second time.
    if (events.includes('push') && !trigger.includes("  push:\n    branches-ignore: ['gh-readonly-queue/**']\n")) found.push(`${workflow.name}: the push trigger lacks branches-ignore: ['gh-readonly-queue/**']`);
  }
  assert.deepEqual(found, []);
});

// The CI groups of the Makefile: CI_GROUPS and the targets CI_TARGETS_<group> of each.
function groups() {
  const makefile = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  const variable = (name) => new RegExp(`^${name} := (.*)$`, 'm').exec(makefile)?.[1].split(' ').filter(Boolean);
  const names = variable('CI_GROUPS') ?? [];
  return { names, targets: Object.fromEntries(names.map((name) => [name, variable(`CI_TARGETS_${name}`) ?? []])), check: variable('CHECK_TARGETS') };
}

test('the CI groups run every target of the full suite once (HY-91)', () => {
  const { names, targets, check } = groups();
  assert.ok(names.length > 1, `CI_GROUPS: ${names.join(' ')}`);
  const all = Object.values(targets).flat();
  assert.deepEqual([...all].sort(), [...check].sort(), 'the targets of the CI groups are not the targets of CHECK_TARGETS, each once');
});

test('the workflow ci runs every CI group in a job that runs to its end and uploads its report (HY-91)', () => {
  const text = readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
  // The ruleset main requires the jobs on every pull request and every merge group, the commit that main receives
  // (HY-94); a push to main never happens outside the merge queue. A manual run checks any branch.
  assert.match(text, /^on:\n {2}pull_request:\n {2}merge_group:\n {2}workflow_dispatch:\n\n/m);
  // The runners are few, so a new push to a pull request stops the run of its previous push (HY-91). A merge group has a
  // ref of its own and its run is never cancelled. The push gate keeps every run: each pushed commit is checked.
  assert.match(text, /^concurrency:\n {2}group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}\n/m);
  assert.doesNotMatch(readFileSync(path.join(WORKFLOWS, 'push-gate.yml'), 'utf8'), /^concurrency:/m);
  const { names, targets } = groups();
  const read = jobs(text).filter((job) => job.name !== CI_PASSED);
  assert.ok(read.length > 0);
  for (const job of read) {
    assert.match(job.text, /^ {4}strategy:\n {6}fail-fast: false\n/m, `${job.name}: fail-fast`);
    const matrix = [...job.text.matchAll(/^ {10}- group: ([\w-]+)$/gm)].map((match) => match[1]);
    assert.deepEqual(matrix, names, `${job.name}: the matrix groups are not CI_GROUPS`);
    const index = (predicate, name) => {
      const at = job.steps.findIndex(predicate);
      assert.ok(at >= 0, `${job.name} has no ${name} step`);
      assert.match(job.steps[at].if ?? '', /^\$\{\{ !cancelled\(\) \}\}$/, `${job.name}: the ${name} step runs only while every earlier step passed`);
      return at;
    };
    const check = index((step) => step.run === 'make ci-check GROUP=${{ matrix.group }}', 'make ci-check');
    const summary = index((step) => step.run === 'make ci-summary GROUP=${{ matrix.group }}', 'make ci-summary');
    const report = index((step) => /^actions\/upload-artifact@/.test(step.uses ?? ''), 'report upload');
    assert.ok(check < summary && summary < report, `${job.name}: the report steps follow make ci-check`);
    assert.match(job.steps[summary].text, /CI_STEPS: \$\{\{ toJSON\(steps\) \}\}/);
    assert.match(job.steps[report].text, /path: hyper\/var\/ci\/\$\{\{ matrix\.group \}\}\/\n/);
    assert.match(job.steps[report].text, /if-no-files-found: error/);
    // Chromium is installed only in the group whose targets run a browser.
    const browser = job.steps.find((step) => step.run === 'make install-browser');
    assert.match(browser?.if ?? '', /matrix\.browser/);
    const flag = (group, name) => new RegExp(`- group: ${group}\\n(?: {12}\\w+: true\\n)* {12}${name}: true\\n`).test(job.text);
    for (const [group, list] of Object.entries(targets)) {
      assert.equal(flag(group, 'browser'), list.some((target) => ['parity', 'server-parity', 'e2e'].includes(target)), `${group}: browser flag`);
    }
  }
});

// The workflow ci checks out the template repository at the tag TEMPLATE_TAG of the Makefile, the one declaration of
// the template release (HY-80), so the copy of `make install` finds that tag and CI checks the same template commit as
// a local run.
test('the workflow ci checks out the template repository at the tag TEMPLATE_TAG of the Makefile (HY-80)', () => {
  const tag = /^TEMPLATE_TAG := (\S+)$/m.exec(readFileSync(path.join(ROOT, 'Makefile'), 'utf8'))?.[1];
  assert.match(tag ?? '', /^v\d+\.\d+\.\d+$/, 'the Makefile declares no TEMPLATE_TAG');
  for (const job of jobs(readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8')).filter((job) => job.name !== CI_PASSED)) {
    const checkouts = job.steps.filter((step) => /^ {10}repository: polyspec\/template$/m.test(step.text));
    assert.equal(checkouts.length, 1, `${job.name}: one checkout of polyspec/template`);
    assert.deepEqual([...checkouts[0].text.matchAll(/^ {10}ref: (.*)$/gm)].map((match) => match[1]), [tag], `${job.name}: the ref of the template checkout is not TEMPLATE_TAG ${tag}`);
  }
});

// A target of the full suite declared for one platform runs there and is never skipped there (HY-68): the full suite of
// Darwin runs DARWIN_TARGETS, which no CI group of Linux runs, and their tests skip no case and fail without their tool.
test('a target declared for Darwin is in the full suite exactly on Darwin and skips nothing there', () => {
  const makefile = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  const darwin = /^DARWIN_TARGETS := (.*)$/m.exec(makefile)?.[1].split(' ').filter(Boolean) ?? [];
  assert.deepEqual(darwin, ['virtiofs-check']);
  const { check } = groups();
  assert.deepEqual(darwin.filter((target) => check.includes(target)), [], 'a Darwin target in the CHECK_TARGETS of every platform');
  const suite = dryRun('check').find((line) => line.includes(' node scripts/full-run.mjs run ')).split(' node scripts/full-run.mjs run ')[1].split(' ');
  assert.deepEqual(suite, process.platform === 'darwin' ? [...check, ...darwin] : check);
  const virtiofs = readdirSync(path.join(ROOT, 'tests/virtiofs')).filter((name) => name.endsWith('.test.mjs'));
  assert.ok(virtiofs.length > 0);
  for (const name of virtiofs) {
    const text = readFileSync(path.join(ROOT, 'tests/virtiofs', name), 'utf8');
    assert.doesNotMatch(text, /\.skip\(|\bskip:|\btodo\b/, `${name} skips a case`);
    assert.match(text, /if \(result\.error\) throw new Error\(`container cannot run: /, `${name} does not fail without container`);
  }
});

/** Each broken rule of the job ci-passed of a workflow text. */
function ciPassedProblems(text) {
  const read = jobs(text);
  const job = read.find((entry) => entry.name === CI_PASSED);
  if (!job) return [`the job ${CI_PASSED} is missing; the ruleset main requires it as the check of ci.yml`];
  const key = (entry, name) => new RegExp(`^ {4}${name}: (.*)$`, 'm').exec(entry.text)?.[1];
  const others = read.filter((entry) => entry.name !== CI_PASSED).map((entry) => entry.name);
  const found = [];
  if (read.at(-1).name !== CI_PASSED) found.push(`the job ${CI_PASSED} is not the last job; the jobs are ${read.map((entry) => entry.name).join(', ')}`);
  if (key(job, 'if') !== '${{ always() }}') found.push(`the job ${CI_PASSED} has if: ${key(job, 'if')}, not \${{ always() }}; it must run after a failed, skipped or cancelled job too`);
  const needs = (key(job, 'needs') ?? '').replace(/^\[|\]$/g, '').split(',').map((name) => name.trim()).filter(Boolean);
  if ([...needs].sort().join() !== [...others].sort().join()) found.push(`the job ${CI_PASSED} needs [${needs.join(', ')}], not every other job [${others.join(', ')}]`);
  const runners = [...new Set(read.filter((entry) => entry.name !== CI_PASSED).map((entry) => key(entry, 'runs-on')))];
  if (runners.length !== 1 || key(job, 'runs-on') !== runners[0]) found.push(`the job ${CI_PASSED} runs on ${key(job, 'runs-on')}, not on the runner of the other jobs ${runners.join(', ')}`);
  const runs = job.steps.filter((step) => step.run !== undefined).map((step) => step.run);
  if (runs.length !== 1 || runs[0] !== CI_PASSED_RUN || job.steps.at(-1).run !== CI_PASSED_RUN) found.push(`the job ${CI_PASSED} runs [${runs.join(', ')}], not the last step ${CI_PASSED_RUN}`);
  return found;
}

test('ci-passed is the last job of ci.yml, runs always, needs every other job and runs make ci-passed (HY-94)', () => {
  const text = readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
  assert.deepEqual(ciPassedProblems(text), []);
  const [head, tail] = text.split('\n  ci-passed:\n');
  const broken = {
    missing: [head + '\n', 'the job ci-passed is missing'],
    'not last': [head.replace('\njobs:\n', `\njobs:\n  ci-passed:\n${tail.trimEnd()}\n`) + '\n', 'the job ci-passed is not the last job'],
    'not always': [text.replace('    if: ${{ always() }}\n', '    if: ${{ success() }}\n'), 'the job ci-passed has if: ${{ success() }}'],
    'needs no job': [text.replace('    needs: [check]\n', '    needs: []\n'), 'the job ci-passed needs [], not every other job [check]'],
    'another runner': [text.replace('    needs: [check]\n    runs-on: ubuntu-26.04-arm\n', '    needs: [check]\n    runs-on: ubuntu-24.04\n'), 'the job ci-passed runs on ubuntu-24.04, not on the runner of the other jobs'],
    'another step': [text.replace(CI_PASSED_RUN, 'make ci-passed'), 'the job ci-passed runs [make ci-passed], not the last step'],
  };
  for (const [name, [changed, message]] of Object.entries(broken)) {
    assert.notEqual(changed, text, name);
    const problems = ciPassedProblems(changed);
    assert.ok(problems.some((problem) => problem.startsWith(message)), `${name}: ${problems.join('; ')}`);
  }
});
