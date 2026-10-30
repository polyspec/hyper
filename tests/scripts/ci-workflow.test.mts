// Tests the rules of the GitHub workflows (HR-86, HR-90, HR-91): every job runs on the declared runner ubuntu-26.04-arm,
// every action is pinned by its commit, no step or job has a time limit, every step after the first of a job runs after a
// failed step (`if: ${{ !cancelled() }}`), except in the jobs whose every step needs the earlier one (STOPPING), and
// every step that runs a command runs one make target, so the exported settings and the checks of the Makefile, such
// as the offline settings and the toolchain check, apply to it. The entries of the matrix of ci.yml run the targets of
// CHECK_TARGETS, each once. The job kit calls .github/workflows/ci-pipeline.yml, the gates of kit (kit K910). The last job of
// ci.yml is ci-passed, which a release requires of the run whose id it takes (HR-95): it runs after every other job (`if: ${{ always() }}`), needs every other job of the workflow, runs on their runner and runs
// `make ci-passed` with the JSON of `needs`.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseJsonObject } from '../../scripts/json.mts';
import { dryRun } from './make-dry-run.mts';
import { kitTool } from './kit-tools.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOWS = path.join(ROOT, '.github/workflows');
const RUNNER = 'ubuntu-26.04-arm';
// The jobs whose every step needs the one before it, so a failed step stops the job: ci-passed reports the results of
// the other jobs of ci.yml, and each step of release reads what the step before it checked or built.
const STOPPING: Record<string, string[]> = { 'ci.yml': ['ci-passed'], 'release.yml': ['release'] };
const CI_PASSED = 'ci-passed';
const CI_PASSED_RUN = "make ci-passed RESULTS='${{ toJSON(needs) }}'";
// The bootstrap of @polyspec/kit in a fresh checkout: the npm of packageManager, then the packages of package-lock.json.
const BOOTSTRAP_RUNS = ['make bootstrap', 'make install-tools TOOLS=npm', 'make install-packages'];

interface Step { text: string; run: string | undefined; uses: string | undefined; if: string | undefined }
interface Job { name: string; text: string; steps: Step[] }

/** The group `index` of `match`; fails when the group took no part in the match. */
function group(match: RegExpExecArray, index: number): string {
  const value = match[index];
  if (value === undefined) throw new Error(`group ${index} of ${JSON.stringify(match[0])} took no part in the match`);
  return value;
}

/** The item `index` of `items` (a negative index counts from the end); fails when there is none. */
function item<T>(items: readonly T[], index: number, what: string): T {
  const value = items.at(index);
  if (value === undefined) throw new Error(`${what} has no item ${index}; it has ${items.length}`);
  return value;
}

/**
 * The jobs of a workflow file, read from the block layout that the workflows of this repository use: a job is a key
 * at indent 2 below `jobs:`, a step is an item `- ` at indent 6 below its `steps:`. Returns
 * [{ name, text, steps: [{ text, run, uses, if }] }].
 */
function jobs(text: string): Job[] {
  const lines = text.split('\n');
  const start = lines.indexOf('jobs:');
  assert.ok(start >= 0, 'the workflow has no jobs: line');
  const found: { name: string; lines: string[]; steps: string[][] }[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const job = /^ {2}([\w-]+):$/.exec(line);
    if (job) {
      found.push({ name: group(job, 1), lines: [], steps: [] });
      continue;
    }
    const current = found.at(-1);
    if (!current) continue;
    current.lines.push(line);
    if (/^ {6}- /.test(line)) current.steps.push([line.replace(/^ {6}- /, '        ')]);
    else if (/^ {8}/.test(line)) current.steps.at(-1)?.push(line);
  }
  const value = (step: string[], key: string) => {
    const line = step.find((entry) => entry.startsWith(`        ${key}:`));
    return line === undefined ? undefined : line.slice(`        ${key}:`.length).trim();
  };
  return found.map((job) => ({
    name: job.name,
    text: job.lines.join('\n'),
    steps: job.steps.map((step) => ({ text: step.join('\n'), run: value(step, 'run'), uses: value(step, 'uses'), if: value(step, 'if') })),
  }));
}

// The workflows of this repository; release.yml and ci-pipeline.yml are copies of workflows of @polyspec/kit (kit.copies),
// whose rules kit tests and make kit-check holds them to, so the rules of this file read the other workflows.
const allWorkflows = () => readdirSync(WORKFLOWS).filter((name) => name.endsWith('.yml')).map((name) => ({ name, text: readFileSync(path.join(WORKFLOWS, name), 'utf8') }));
const KIT_COPIES = ['release.yml', 'ci-pipeline.yml'];
const workflows = () => allWorkflows().filter((workflow) => !KIT_COPIES.includes(workflow.name));
// The job of ci.yml that calls the gates workflow of kit (kit K910). A job with `uses:` runs the jobs of the workflow that it
// calls, so it has no runner and no steps of its own; the rules of runners and steps read the jobs that run steps.
const KIT_JOB = 'kit';
const KIT_PIPELINE = './.github/workflows/ci-pipeline.yml';
const calls = (job: Job) => /^ {4}uses: /m.test(job.text);

test('the reader finds the jobs and the steps of a workflow', () => {
  const read = jobs('on:\n  push:\njobs:\n  first:\n    runs-on: x\n    steps:\n      - uses: a/b@c\n        with:\n          d: e\n      - run: make one\n        if: ${{ !cancelled() }}\n  second:\n    steps:\n      - id: s\n        run: make two\n');
  assert.deepEqual(read.map((job) => job.name), ['first', 'second']);
  assert.deepEqual(item(read, 0, 'the jobs').steps.map((step) => [step.uses, step.run, step.if]), [['a/b@c', undefined, undefined], [undefined, 'make one', '${{ !cancelled() }}']]);
  assert.equal(item(item(read, 1, 'the jobs').steps, 0, 'the steps of second').run, 'make two');
});

test('every job runs on the declared runner without a time limit, and every action is pinned by its commit', () => {
  const found: string[] = [];
  for (const workflow of workflows()) {
    if (/timeout-minutes/.test(workflow.text)) found.push(`${workflow.name}: timeout-minutes`);
    for (const job of jobs(workflow.text).filter((job) => !calls(job))) {
      if (!new RegExp(`^ {4}runs-on: ${RUNNER}$`, 'm').test(job.text)) found.push(`${workflow.name} ${job.name}: runs-on is not ${RUNNER}`);
      for (const step of job.steps) {
        if (step.uses === undefined || step.uses === '') continue;
        if (!/^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v?\d/.test(step.uses)) found.push(`${workflow.name} ${job.name}: ${step.uses} is not pinned by a commit with its release`);
      }
    }
  }
  assert.deepEqual(found, []);
});

test('every step that runs a command runs make, and every step after the first runs after a failed step (HR-86)', () => {
  const found: string[] = [];
  for (const workflow of workflows()) {
    for (const job of jobs(workflow.text).filter((job) => !calls(job))) {
      assert.ok(job.steps.length > 0, `${workflow.name} ${job.name} has no step`);
      job.steps.forEach((step, index) => {
        if (step.run !== undefined && !/^make [^|&;<>`$\n]*(\$\{\{ [^}]+ \}\}[^|&;<>`$\n]*)*$/.test(step.run)) found.push(`${workflow.name} ${job.name}: the step "${step.run}" runs a command other than one make`);
        if (index > 0 && !(STOPPING[workflow.name] ?? []).includes(job.name) && !(step.if ?? '').includes('!cancelled()')) found.push(`${workflow.name} ${job.name}: step ${index + 1} runs only while every earlier step passed`);
      });
    }
  }
  assert.deepEqual(found, []);
});

// The on: block of each workflow, exactly: the checks run on the push of main and on every manual run; the release on a
// manual run with the id of a successful CI run and its version, and on no tag push; the gates of kit when ci.yml calls them.
// No other workflow exists, and none runs on a pull request or a merge group (HR-91, HR-95).
const TRIGGERS: Record<string, string> = {
  'ci.yml': 'on:\n  push:\n    branches: [main]\n  workflow_dispatch:\n',
  'release.yml': 'on:\n  workflow_dispatch:\n    inputs:\n      run:\n        description: The id of the successful CI run of main whose commit is released\n        required: true\n        type: string\n      version:\n        description: The version of the release, X.Y.Z, such as 0.0.1\n        required: true\n        type: string\n',
  // The gates workflow of @polyspec/kit (K910), a copy that make kit-check holds to the package, which only the job kit calls.
  'ci-pipeline.yml': 'on:\n  workflow_call:\n',
};

/**
 * The ways in which a workflow starts on a tag push: a tag push starts every workflow whose `push:` has a `tags:` filter or no
 * `branches:` filter. No workflow starts so: a release takes the id of a successful CI run of main and tags its commit with
 * make release-tag, so no tag is pushed before a release and no run of a tag stands for one (HR-95).
 */
function tagStartProblems(name: string, text: string): string[] {
  const trigger = /^on:\n((?: {2}.*\n)+)/m.exec(text)?.[1] ?? '';
  const push = /^ {2}push:\n((?: {4}.*\n)*)/m.exec(trigger)?.[1];
  const tagged = push !== undefined && (/^ {4}tags:/m.test(push) || !/^ {4}branches(-ignore)?:/m.test(push));
  return tagged ? [`${name}: the push trigger starts on a tag; it needs branches: [main]`] : [];
}

test('no workflow starts on a tag push (HR-95)', () => {
  assert.deepEqual(allWorkflows().flatMap((workflow) => tagStartProblems(workflow.name, workflow.text)), []);
  // A workflow with a push trigger that has no branch filter, or a tag filter, is found, release.yml too.
  assert.equal(tagStartProblems('ci.yml', 'on:\n  push:\n  workflow_dispatch:\n').length, 1);
  assert.equal(tagStartProblems('ci.yml', "on:\n  push:\n    tags: ['v*']\n").length, 1);
  assert.equal(tagStartProblems('release.yml', "on:\n  push:\n    tags: ['v*']\n").length, 1);
  assert.equal(tagStartProblems('ci.yml', 'on:\n  push:\n    branches: [main]\n  workflow_dispatch:\n').length, 0);
  assert.equal(tagStartProblems('push-gate.yml', "on:\n  push:\n    branches-ignore: ['gh-readonly-queue/**']\n").length, 0);
});

test('each workflow declares exactly its triggers (HR-91, HR-95)', () => {
  assert.deepEqual(allWorkflows().map(workflow => workflow.name).sort(), Object.keys(TRIGGERS).sort());
  for (const workflow of allWorkflows()) {
    const declared = /^(on:\n(?: {2}.*\n)+)/m.exec(workflow.text)?.[1] ?? '';
    assert.equal(declared, TRIGGERS[workflow.name], `${workflow.name} declares other triggers`);
  }
  // No workflow of this repository names a pull request, which it never opens.
  for (const workflow of workflows()) assert.doesNotMatch(workflow.text, /pull_request|merge_group|gh-readonly-queue/, `${workflow.name} names a pull request or a merge group`);
});

/**
 * The entries of the matrix of ci.yml, read from the block layout: an entry is an item `- name: <name>` at indent 10 and its
 * keys are at indent 12. Returns the targets, browser flag and remaining declared keys.
 */
interface MatrixEntry { name: string; targets: string[]; browser: boolean; keys: Record<string, string> }

function matrixEntries(text: string): MatrixEntry[] {
  const entries: { name: string; keys: Record<string, string> }[] = [];
  for (const line of text.split('\n')) {
    const named = /^ {10}- name: (\S+)$/.exec(line);
    if (named) { entries.push({ name: group(named, 1), keys: {} }); continue; }
    const key = /^ {12}(\w+): (.*)$/.exec(line);
    const last = entries.at(-1);
    if (key && last) last.keys[group(key, 1)] = group(key, 2).replace(/^'(.*)'$/, '$1');
  }
  return entries.map(entry => ({ name: entry.name, keys: entry.keys, targets: (entry.keys['targets'] ?? '').split(' ').filter(Boolean), browser: entry.keys['browser'] === 'true' }));
}

// CHECK_TARGETS of the Makefile without the targets of one platform.
function checkTargets(): string[] {
  const makefile = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  const targets = /^CHECK_TARGETS := (.*)$/m.exec(makefile)?.[1];
  if (targets === undefined) throw new Error('the Makefile declares no CHECK_TARGETS');
  return targets.split(' ').filter(Boolean);
}

test('the matrix entries of ci.yml run every target of the full suite once (HR-91)', () => {
  const entries = matrixEntries(readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8'));
  assert.ok(entries.length > 1, JSON.stringify(entries));
  assert.equal(new Set(entries.map(entry => entry.name)).size, entries.length, 'a matrix name repeats; the reports of two entries would share one artifact');
  const groups = new Map<string, MatrixEntry[]>();
  for (const entry of entries) {
    const key = entry.targets.join(' ');
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  for (const [key, same] of groups) assert.equal(same.length, 1, `${key} runs in ${same.map(entry => entry.name).join(', ')}`);
  const all = [...groups.keys()].flatMap(key => key.split(' '));
  assert.deepEqual([...all].sort(), [...checkTargets()].sort(), 'the targets of the matrix entries are not the targets of CHECK_TARGETS, each once');
});

test('the workflow ci runs every matrix entry in a job that runs to its end and uploads its report (HR-91)', () => {
  const text = readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
  const read = jobs(text).filter((job) => job.name !== CI_PASSED && !calls(job));
  assert.ok(read.length > 0);
  for (const job of read) {
    assert.match(job.text, /^ {4}strategy:\n {6}fail-fast: false\n/m, `${job.name}: fail-fast`);
    const index = (predicate: (step: Step) => boolean, name: string) => {
      const at = job.steps.findIndex(predicate);
      assert.ok(at >= 0, `${job.name} has no ${name} step`);
      assert.match(item(job.steps, at, job.name).if ?? '', /^\$\{\{ !cancelled\(\) \}\}$/, `${job.name}: the ${name} step runs only while every earlier step passed`);
      return at;
    };
    const check = index((step) => step.run === 'make ci-targets TARGETS="${{ matrix.targets }}" CI_REPORT=var/ci/${{ matrix.name }}', 'make ci-targets');
    const summary = index((step) => step.run === 'make ci-summary CI_REPORT=var/ci/${{ matrix.name }}', 'make ci-summary');
    const report = index((step) => (step.uses ?? '').startsWith('actions/upload-artifact@'), 'report upload');
    assert.ok(check < summary && summary < report, `${job.name}: the report steps follow make ci-targets`);
    assert.match(item(job.steps, summary, job.name).text, /CI_STEPS: \$\{\{ toJSON\(steps\) \}\}/);
    const reportStep = item(job.steps, report, job.name);
    assert.match(reportStep.text, /path: hyper\/var\/ci\/\$\{\{ matrix\.name \}\}\/\n/);
    assert.match(reportStep.text, /if-no-files-found: error/);
    assert.match(reportStep.text, /name: ci-\$\{\{ matrix\.name \}\}-/);
    // Chromium is installed only in the entries whose targets run a browser.
    const browser = job.steps.find((step) => step.run === 'make hyper-install-browser');
    assert.match(browser?.if ?? '', /matrix\.browser/);
    for (const entry of matrixEntries(text)) {
      assert.equal(entry.browser, entry.targets.some((target) => ['parity', 'server-parity', 'server-parity-python', 'e2e'].includes(target)), `${entry.name}: browser flag`);
    }
    // The Makefile includes the kit.mk of @polyspec/kit only after the bootstrap installs the npm of packageManager and the
    // packages, and the recipes run the Python of var/tools, so every job runs the bootstrap and make install-tools in this
    // order before its first check.
    const runs = job.steps.map((step) => step.run);
    const order = [...BOOTSTRAP_RUNS, 'make install-tools TOOLS="${{ matrix.tools }}"'].map((run) => runs.indexOf(run));
    const checks = runs.findIndex((run) => run?.startsWith('make ci-targets'));
    assert.ok(order.every((at, index) => at >= 0 && (index === 0 || item(order, index - 1, 'the bootstrap steps') < at)) && item(order, -1, 'the bootstrap steps') < checks, `${job.name}: ${[...BOOTSTRAP_RUNS, 'make install-tools TOOLS="${{ matrix.tools }}"'].join(', ')} run in order before the checks`);
    assert.ok(!job.steps.some((step) => (step.uses ?? '').startsWith('actions/setup-python@')), `${job.name}: no setup-python step`);
  }
});

// The workflow ci checks out the template repository at the tag TEMPLATE_TAG of the Makefile, the one declaration of
// the template release (HR-80), so the copy of `make hyper-install` finds that tag and CI checks the same template commit as
// a local run.
test('the workflow ci checks out the template repository at the tag TEMPLATE_TAG of the Makefile (HR-80)', () => {
  // TEMPLATE_TAG is v$(TEMPLATE_VERSION) of the Makefile (H27.45); make template-tag names it.
  const lines = dryRun('template-tag', { variables: ['TEMPLATE_REPOSITORY=/nonexistent/hyper-template'] });
  const tag = lines.map((line) => /'refs\/tags\/(v\d+\.\d+\.\d+)\^\{commit\}'/.exec(line)?.[1]).find((found) => found !== undefined);
  assert.match(tag ?? '', /^v\d+\.\d+\.\d+$/, `make template-tag names no tag TEMPLATE_TAG: ${lines.join('\n')}`);
  for (const job of jobs(readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8')).filter((job) => job.name !== CI_PASSED && !calls(job))) {
    const checkouts = job.steps.filter((step) => /^ {10}repository: polyspec\/template$/m.test(step.text));
    assert.equal(checkouts.length, 1, `${job.name}: one checkout of polyspec/template`);
    assert.deepEqual([...item(checkouts, 0, `${job.name}: the template checkouts`).text.matchAll(/^ {10}ref: (.*)$/gm)].map((match) => match[1]), [tag], `${job.name}: the ref of the template checkout is not TEMPLATE_TAG ${tag}`);
  }
});

// A target of the full suite declared for one platform runs there and is never skipped there (HR-68): the full suite of
// Darwin runs DARWIN_TARGETS, which no CI group of Linux runs, and their tests skip no case and fail without their tool.
test('a target declared for Darwin is in the full suite exactly on Darwin and skips nothing there', () => {
  const makefile = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  const darwin = /^DARWIN_TARGETS := (.*)$/m.exec(makefile)?.[1]?.split(' ').filter(Boolean) ?? [];
  assert.deepEqual(darwin, ['virtiofs-check']);
  const check = checkTargets();
  assert.deepEqual(darwin.filter((target) => check.includes(target)), [], 'a Darwin target in the CHECK_TARGETS of every platform');
  const command = ` ${kitTool('ci-targets')} var/report/full-run `;
  const line = dryRun('check').find((entry) => entry.includes(command));
  assert.ok(line, 'make check does not run ci-targets of @polyspec/kit');
  assert.ok(line.startsWith('FINAL_RUN=1 '), 'make check requires an explicit local final verification mode');
  const suite = item(line.split(command), 1, 'the final verification command').split(' ');
  assert.deepEqual(suite, process.platform === 'darwin' ? [...check, ...darwin] : check);
  const virtiofs = readdirSync(path.join(ROOT, 'tests/virtiofs')).filter((name) => name.endsWith('.test.mts'));
  assert.ok(virtiofs.length > 0);
  for (const name of virtiofs) {
    const text = readFileSync(path.join(ROOT, 'tests/virtiofs', name), 'utf8');
    assert.doesNotMatch(text, /\.skip\(|\bskip:|\btodo\b/, `${name} skips a case`);
    assert.match(text, /if \(result\.error\) throw new Error\(`container cannot run: /, `${name} does not fail without container`);
  }
});

/** Each broken rule of the job ci-passed of a workflow text. */
function ciPassedProblems(text: string): string[] {
  const read = jobs(text);
  const job = read.find((entry) => entry.name === CI_PASSED);
  if (!job) return [`the job ${CI_PASSED} is missing; a release requires it of the CI run whose id it takes`];
  const key = (entry: Job, name: string) => new RegExp(`^ {4}${name}: (.*)$`, 'm').exec(entry.text)?.[1];
  const others = read.filter((entry) => entry.name !== CI_PASSED).map((entry) => entry.name);
  const found: string[] = [];
  if (read.at(-1)?.name !== CI_PASSED) found.push(`the job ${CI_PASSED} is not the last job; the jobs are ${read.map((entry) => entry.name).join(', ')}`);
  if (key(job, 'if') !== '${{ always() }}') found.push(`the job ${CI_PASSED} has if: ${key(job, 'if')}, not \${{ always() }}; it must run after a failed, skipped or cancelled job too`);
  const needs = (key(job, 'needs') ?? '').replace(/^\[|\]$/g, '').split(',').map((name) => name.trim()).filter(Boolean);
  if ([...needs].sort().join() !== [...others].sort().join()) found.push(`the job ${CI_PASSED} needs [${needs.join(', ')}], not every other job [${others.join(', ')}]`);
  const runners = [...new Set(read.filter((entry) => entry.name !== CI_PASSED && !calls(entry)).map((entry) => key(entry, 'runs-on')))];
  if (runners.length !== 1 || key(job, 'runs-on') !== runners[0]) found.push(`the job ${CI_PASSED} runs on ${key(job, 'runs-on')}, not on the runner of the other jobs ${runners.join(', ')}`);
  const runs = job.steps.filter((step) => step.run !== undefined).map((step) => step.run);
  const expected = [...BOOTSTRAP_RUNS, CI_PASSED_RUN];
  if (runs.join('\n') !== expected.join('\n') || job.steps.at(-1)?.run !== CI_PASSED_RUN) found.push(`the job ${CI_PASSED} runs [${runs.join(', ')}], not the bootstrap and the last step ${CI_PASSED_RUN}`);
  return found;
}

test('ci-passed is the last job of ci.yml, runs always, needs every other job and runs make ci-passed (HR-95)', () => {
  const text = readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
  assert.deepEqual(ciPassedProblems(text), []);
  const [head, tail] = text.split('\n  ci-passed:\n');
  assert.ok(head !== undefined && tail !== undefined, 'ci.yml has no job ci-passed');
  const broken: Record<string, [string, string]> = {
    missing: [head + '\n', 'the job ci-passed is missing'],
    'not last': [head.replace('\njobs:\n', `\njobs:\n  ci-passed:\n${tail.trimEnd()}\n`) + '\n', 'the job ci-passed is not the last job'],
    'not always': [text.replace('    if: ${{ always() }}\n', '    if: ${{ success() }}\n'), 'the job ci-passed has if: ${{ success() }}'],
    'needs no job': [text.replace('    needs: [check, kit]\n', '    needs: []\n'), 'the job ci-passed needs [], not every other job [kit, check]'],
    'needs no kit': [text.replace('    needs: [check, kit]\n', '    needs: [check]\n'), 'the job ci-passed needs [check], not every other job [kit, check]'],
    'another runner': [text.replace('    needs: [check, kit]\n    runs-on: ubuntu-26.04-arm\n', '    needs: [check, kit]\n    runs-on: ubuntu-24.04\n'), 'the job ci-passed runs on ubuntu-24.04, not on the runner of the other jobs'],
    'another step': [text.replace(CI_PASSED_RUN, 'make ci-passed'), 'the job ci-passed runs [make bootstrap, make install-tools TOOLS=npm, make install-packages, make ci-passed], not the bootstrap'],
    'no bootstrap': [text.replace('        run: make install-packages\n      - name: make ci-passed', '      - name: make ci-passed'), 'the job ci-passed runs [make bootstrap, make install-tools TOOLS=npm, make ci-passed'],
  };
  for (const [name, [changed, message]] of Object.entries(broken)) {
    assert.notEqual(changed, text, name);
    const problems = ciPassedProblems(changed);
    assert.ok(problems.some((problem) => problem.startsWith(message)), `${name}: ${problems.join('; ')}`);
  }
});


/**
 * The problems of the PHP that the workflows set up: `.php-version` holds one minor release, and every setup-php step
 * reads it by `php-version-file` (a path that ends in `.php-version`, such as that of a checkout into a folder) instead
 * of naming a PHP itself, so the release workflow of kit and the jobs of CI start the same PHP (kit K193).
 */
function phpVersionProblems(phpVersion: string, files: { name: string; text: string }[]): string[] {
  const found: string[] = [];
  if (!/^\d+\.\d+\n$/.test(phpVersion)) found.push(`.php-version holds ${JSON.stringify(phpVersion)}, not one minor release such as 8.5`);
  for (const workflow of files) {
    for (const job of jobs(workflow.text)) {
      for (const step of job.steps) {
        if (!step.uses?.startsWith('shivammathur/setup-php@')) continue;
        if (!/^ {10}php-version-file: (?:[\w.-]+\/|\$\{\{ github\.event\.repository\.name \}\}\/)?\.php-version$/m.test(step.text)) found.push(`${workflow.name} ${job.name}: a setup-php step does not read php-version-file: .php-version`);
        if (/^ {10}php-version:/m.test(step.text)) found.push(`${workflow.name} ${job.name}: a setup-php step names php-version itself`);
      }
    }
  }
  return found;
}

test('.php-version holds the PHP minor release, and every setup-php step reads it (kit K193)', () => {
  const phpVersion = readFileSync(path.join(ROOT, '.php-version'), 'utf8');
  const files = allWorkflows();
  assert.ok(files.some((workflow) => workflow.text.includes('shivammathur/setup-php@')), 'no workflow sets up PHP');
  assert.deepEqual(phpVersionProblems(phpVersion, files), []);
  const named = files.map((workflow) => ({ ...workflow, text: workflow.text.replace(/php-version-file: \S*\.php-version/g, "php-version: '8.5'") }));
  assert.ok(phpVersionProblems(phpVersion, named).some((problem) => problem.endsWith('names php-version itself')));
  assert.ok(phpVersionProblems('8.5.10\n', files).some((problem) => problem.startsWith('.php-version holds')));
});


test('H27.20 PHP-enabled CI groups prepare PHP before selected tool installation', () => {
  for (const job of jobs(readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8')).filter(job => job.name !== CI_PASSED && !calls(job))) {
    const php = job.steps.findIndex(step => step.uses?.startsWith('shivammathur/setup-php@'));
    const tools = job.steps.findIndex(step => step.run === 'make install-tools TOOLS="${{ matrix.tools }}"');
    assert.ok(php >= 0 && php < tools, `${job.name}: declared PHP must exist before tool discovery`);
    assert.equal(job.steps[php]?.if, '${{ !cancelled() && matrix.php }}', `${job.name}: PHP setup follows the declared environment`);
  }
});

test('H27.20 every CI check group installs per-checkout hook configuration before checks', () => {
  for (const job of jobs(readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8')).filter(job => job.name !== CI_PASSED && !calls(job))) {
    const installed = job.steps.findIndex(step => step.run === 'make install-packages');
    const hooks = job.steps.findIndex(step => step.run === 'make hooks');
    const check = job.steps.findIndex(step => step.run?.startsWith('make ci-targets'));
    assert.ok(installed < hooks && hooks < check, `${job.name}: native hook setup must follow installation and precede checks`);
  }
});


// kit K870, K910: .github/workflows/ci-pipeline.yml, which the job kit calls, runs the gates of kit, cross-language parity among
// them, so no entry of ci.yml runs one again; the gates are the prerequisites of the kit-gates-* targets of the installed kit.mk.
test('H27.24 no matrix entry of ci.yml runs a gate of kit, which ci-pipeline.yml runs (HY-1, HY-27, HY-114, HR-91)', () => {
  const kit = readFileSync(path.join(path.dirname(kitTool('run-tests')), 'kit.mk'), 'utf8');
  const gates = [...kit.matchAll(/^kit-gates-[\w-]+: ([^#\n]+)/gm)].flatMap(match => (match[1] ?? '').trim().split(/\s+/));
  assert.ok(gates.includes('parity-check') && gates.includes('parity-declarations-check'), gates.join(' '));
  const entries = matrixEntries(readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8'));
  for (const entry of entries) assert.deepEqual(entry.targets.filter(target => gates.includes(target)), [], `${entry.name} runs gates of kit`);
  const check = jobs(readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8')).find(job => job.name === 'check');
  assert.ok(check !== undefined);
  assert.doesNotMatch(check.text, /^ {4}needs:/m, 'matrix checks must start independently');
});


// H27.47-3: the lint tools of kit, which only the lint gates of kit start from their own scripts; ci-pipeline.yml runs those gates
// (kit K870), and hyper-lint and analyse-php run the pint and PHPStan of vendor, so no CI job of hyper installs them.
const KIT_LINT_TOOLS = ['ruff', 'vulture', 'alint', 'phpcs', 'phpstan', 'golangciLint', 'deadcode', 'govulncheck', 'cargoAudit', 'cargoDeny'];

test('H27.47-3 no matrix entry of ci.yml installs a lint tool of kit, which only the gates of ci-pipeline.yml start', () => {
  for (const entry of matrixEntries(readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8'))) {
    const tools = (entry.keys['tools'] ?? '').split(' ');
    assert.deepEqual(tools.filter(tool => KIT_LINT_TOOLS.includes(tool)), [], `${entry.name} installs lint tools of kit that none of its targets starts`);
  }
});


test('H27.25 CI declares job-owned tools and locked package environments (HR-81, HR-89, HR-91)', () => {
  const text = readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
  const entries = matrixEntries(text);
  const expected: Record<string, { tools: string; php?: boolean; composer?: boolean; python?: boolean }> = {
    docs: { tools: 'node php composer pie python uv', php: true, composer: true, python: true },
    php: { tools: 'node php composer pie', php: true, composer: true },
    node: { tools: 'node' },
    board: { tools: 'node php composer pie python uv', php: true, composer: true, python: true },
    python: { tools: 'node python uv', python: true },
  };
  assert.deepEqual(entries.map(entry => entry.name).sort(), Object.keys(expected).sort());
  for (const entry of entries) {
    const profile = expected[entry.name];
    assert.ok(profile !== undefined);
    assert.equal(entry.keys['tools'], profile.tools, `${entry.name}: declared tool selection`);
    assert.ok(!profile.tools.split(' ').includes('npm'), 'npm belongs to the separate bootstrap selector');
    assert.equal(entry.keys['symbols'], entry.name === 'docs' ? 'php' : undefined, `${entry.name}: explicit extractor selection, which public-symbols of hyper-test-scripts reads`);
    for (const key of ['php', 'composer', 'python'] as const) assert.equal(entry.keys[key] === 'true', profile[key] === true, `${entry.name}: ${key} environment`);
  }
  const checks = jobs(text).find(job => job.name === 'check');
  assert.ok(checks !== undefined);
  assert.ok(checks.steps.some(step => step.run === 'make install-tools TOOLS="${{ matrix.tools }}"'));
  assert.ok(!checks.steps.some(step => step.run === 'make install-tools' || step.run === 'make hyper-install' || step.run === 'make install'));
  assert.doesNotMatch(checks.text, /actions\/download-artifact@|^ {4}needs:/m);
  const symbols = checks.steps.find(step => step.run === 'make kit-install-symbols EXTRACTORS="${{ matrix.symbols }}"');
  assert.equal(symbols?.if, '${{ !cancelled() && matrix.symbols }}');
  const php = checks.steps.find(step => step.run === 'make hyper-install-php');
  const python = checks.steps.find(step => step.run === 'make hyper-install-python');
  assert.equal(php?.if, '${{ !cancelled() && matrix.composer }}');
  assert.equal(python?.if, '${{ !cancelled() && matrix.python }}');
  assert.ok(entries.find(entry => entry.name === 'docs')?.targets.includes('hyper-test-scripts'));
  assert.ok(entries.find(entry => entry.name === 'python')?.targets.includes('hyper-test-python-render'));
  assert.ok(entries.find(entry => entry.name === 'board')?.targets.includes('server-parity-python'));
});


test('H27.25-1 common CI policy checks use locked releases without sibling template sources (HR-70, HR-79, HR-91)', () => {
  const text = readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
  const entries = matrixEntries(text);
  const policy = entries.find(entry => entry.name === 'docs');
  assert.ok(policy !== undefined);
  assert.notEqual(policy.keys['template'], 'true');
  const check = jobs(text).find(job => job.name === 'check');
  assert.ok(check !== undefined);
  const template = check.steps.find(step => step.text.includes('repository: polyspec/template'));
  assert.equal(template?.if, '${{ !cancelled() && matrix.template }}', 'source checkout must have its own explicit selection');
  assert.deepEqual(entries.filter(entry => entry.keys['template'] === 'true').map(entry => entry.name).sort(), ['board', 'php']);
});


test('H27.26 provider gate setup declares every native runtime and full parity coverage (HR-81, HR-91)', () => {
  const ci = parseJsonObject(readFileSync(path.join(ROOT, 'config/ci.json'), 'utf8'), 'config/ci.json');
  assert.equal(ci.parityMode, 'full');
  const setup = ci.setup;
  assert.ok(typeof setup === 'object' && setup !== null && !Array.isArray(setup));
  const text = JSON.stringify(setup);
  assert.ok(text.includes('hyper-install-php') && text.includes('hyper-install-python') && text.includes('server-fixtures') && text.includes('node-fixtures'));
  assert.doesNotMatch(text, /"(?:install|install-kit|parity-check|kit-gates)"/);
  // hyper-install-php runs template-ext, whose recipe runs the http:pie of mise.toml (H27.51); the pipeline installs
  // the tools of the php runtime there and, since kit adds the tools of every runtime to the parity phase, in parity too.
  const tools = ci.tools;
  assert.ok(typeof tools === 'object' && tools !== null && !Array.isArray(tools));
  const php: unknown = new Map(Object.entries(tools)).get('php');
  assert.ok(Array.isArray(php) && php.includes('pie'), 'config/ci.json tools.php installs no pie');
});

// kit K910: the job kit of ci.yml calls ci-pipeline.yml, the gates of kit, and is the only job that calls a workflow; ci-passed
// needs it, so a release requires the gates of kit of its run.
test('the job kit calls ci-pipeline.yml of kit, and ci-passed needs it (kit K910, HR-95)', () => {
  const read = jobs(readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8'));
  assert.deepEqual(read.filter(calls).map((job) => [job.name, job.text.trim()]), [[KIT_JOB, `uses: ${KIT_PIPELINE}`]]);
  const passed = read.find((job) => job.name === CI_PASSED);
  assert.match(passed?.text ?? '', new RegExp(`^ {4}needs: \\[[^\\]]*\\b${KIT_JOB}\\b[^\\]]*\\]$`, 'm'));
});
