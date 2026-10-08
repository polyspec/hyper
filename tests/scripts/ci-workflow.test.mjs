// Tests the rules of the GitHub workflows (HY-86, HY-90, HY-91): every job runs on the declared runner ubuntu-26.04-arm,
// every action is pinned by its commit, no step or job has a time limit, every step after the first of a job runs after a
// failed step (`if: ${{ !cancelled() }}`), except in the jobs whose every step needs the earlier one (STOPPING), and
// every step that runs a command runs one make target, so the exported settings and the checks of the Makefile, such
// as the offline settings and the toolchain check, apply to it. The entries of the matrix of ci.yml run the targets of
// CHECK_TARGETS, each once. The last job of ci.yml is ci-passed, the check that a release tag requires (HY-95): it runs
// after every other job (`if: ${{ always() }}`), needs every other job of the workflow, runs on their runner and runs
// `make ci-passed` with the JSON of `needs`.
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

// The on: block of each workflow, exactly: the checks run on the push of main and on every manual run; the release on
// the push of a tag vX.Y.Z or <directory>/vX.Y.Z at any depth (in a tag filter * does not match /, so **/v* covers a Go
// module tag). No other workflow exists, and none runs on a pull request or a merge group (HY-91, HY-95).
const TRIGGERS = {
  'ci.yml': 'on:\n  push:\n    branches: [main]\n  workflow_dispatch:\n',
  'release.yml': "on:\n  push:\n    tags: ['v*', '**/v*']\n",
};
// The steps of release.yml in their order (scripts/kit/release.mjs): verify the tagged commit, check the versions, build
// the archives, create the release.
const RELEASE_STEPS = ['make release-verify', 'make release-versions', 'make release-assets', 'make release-publish'];

/**
 * The ways in which a workflow starts on a tag push. A tag push starts every workflow whose `push:` has no `branches:`
 * filter, and the check runs of that workflow then stand on the tagged commit, where `make release-verify` requires the
 * checks of config/release.json to be successful (HY-95). Only release.yml may run on a tag.
 */
function tagStartProblems(name, text) {
  const trigger = /^on:\n((?: {2}.*\n)+)/m.exec(text)?.[1] ?? '';
  const push = /^ {2}push:\n((?: {4}.*\n)*)/m.exec(trigger)?.[1];
  const tagged = push !== undefined && (/^ {4}tags:/m.test(push) || !/^ {4}branches(-ignore)?:/m.test(push));
  if (name === 'release.yml') return tagged && /^ {4}tags:/m.test(push) && !/^ {4}branches/m.test(push) ? [] : ['release.yml is not triggered by tags only'];
  return tagged ? [`${name}: the push trigger starts on a tag; it needs branches: [main]`] : [];
}

test('only release.yml starts on a tag, and no check of config/release.json comes from a workflow that a tag starts (HY-95)', () => {
  const read = workflows();
  assert.deepEqual(read.flatMap((workflow) => tagStartProblems(workflow.name, workflow.text)), []);
  const checks = JSON.parse(readFileSync(path.join(ROOT, 'config/release.json'), 'utf8')).checks;
  assert.ok(checks.length > 0, 'config/release.json names no check');
  for (const check of checks) {
    const owners = read.filter((workflow) => jobs(workflow.text).some((job) => job.name === check)).map((workflow) => workflow.name);
    assert.ok(owners.length > 0, `no workflow has the job ${check}`);
    assert.deepEqual(owners.filter((name) => tagStartProblems(name, read.find((workflow) => workflow.name === name).text).length > 0 || name === 'release.yml'), [], `${check} is started by a tag`);
  }
  // A workflow with a push trigger that has no branch filter, or a tag filter, is found.
  assert.equal(tagStartProblems('ci.yml', 'on:\n  push:\n  workflow_dispatch:\n').length, 1);
  assert.equal(tagStartProblems('ci.yml', "on:\n  push:\n    tags: ['v*']\n").length, 1);
  assert.equal(tagStartProblems('ci.yml', 'on:\n  push:\n    branches: [main]\n  workflow_dispatch:\n').length, 0);
  assert.equal(tagStartProblems('push-gate.yml', "on:\n  push:\n    branches-ignore: ['gh-readonly-queue/**']\n").length, 0);
  assert.equal(tagStartProblems('release.yml', "on:\n  push:\n    tags: ['v*']\n").length, 0);
});

test('each workflow declares exactly its triggers (HY-91, HY-95)', () => {
  assert.deepEqual(workflows().map(workflow => workflow.name).sort(), Object.keys(TRIGGERS).sort());
  for (const workflow of workflows()) {
    const declared = /^(on:\n(?: {2}.*\n)+)/m.exec(workflow.text)?.[1] ?? '';
    assert.equal(declared, TRIGGERS[workflow.name], `${workflow.name} declares other triggers`);
  }
  // The trigger */v* matches a tag with one / only, so it misses a Go module tag deeper in the tree.
  assert.notEqual("on:\n  push:\n    tags: ['v*', '*/v*']\n", TRIGGERS['release.yml']);
  for (const workflow of workflows()) assert.doesNotMatch(workflow.text, /pull_request|merge_group|gh-readonly-queue/, `${workflow.name} names a pull request or a merge group`);
});

/**
 * The entries of the matrix of ci.yml, read from the block layout: an entry is an item `- name: <name>` at indent 10 and its
 * keys are at indent 12. Returns [{ name, targets: [...], install, browser, python }].
 */
function matrixEntries(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    const item = /^ {10}- name: (\S+)$/.exec(line);
    if (item) { entries.push({ name: item[1] }); continue; }
    const key = /^ {12}(\w+): (.*)$/.exec(line);
    if (key && entries.length > 0) entries.at(-1)[key[1]] = key[2].replace(/^'(.*)'$/, '$1');
  }
  return entries.map(entry => ({ ...entry, targets: (entry.targets ?? '').split(' ').filter(Boolean), install: entry.install === 'true', browser: entry.browser === 'true' }));
}

// CHECK_TARGETS of the Makefile without the targets of one platform.
function checkTargets() {
  const makefile = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  return /^CHECK_TARGETS := (.*)$/m.exec(makefile)?.[1].split(' ').filter(Boolean);
}

test('the matrix entries of ci.yml run every target of the full suite once (HY-91)', () => {
  const entries = matrixEntries(readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8'));
  assert.ok(entries.length > 1, JSON.stringify(entries));
  assert.equal(new Set(entries.map(entry => entry.name)).size, entries.length, 'a matrix name repeats; the reports of two entries would share one artifact');
  // An entry that repeats the targets of another entry runs them on another release of its tool, as python-3.11 does.
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.targets.join(' ');
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  for (const [key, same] of groups) assert.ok(same.length === 1 || same.every(entry => entry.name.startsWith('python')), `${key} runs in ${same.map(entry => entry.name).join(', ')}`);
  const all = [...groups.keys()].flatMap(key => key.split(' '));
  assert.deepEqual([...all].sort(), [...checkTargets()].sort(), 'the targets of the matrix entries are not the targets of CHECK_TARGETS, each once');
});

test('the workflow ci runs every matrix entry in a job that runs to its end and uploads its report (HY-91)', () => {
  const text = readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
  const read = jobs(text).filter((job) => job.name !== CI_PASSED);
  assert.ok(read.length > 0);
  for (const job of read) {
    assert.match(job.text, /^ {4}strategy:\n {6}fail-fast: false\n/m, `${job.name}: fail-fast`);
    const index = (predicate, name) => {
      const at = job.steps.findIndex(predicate);
      assert.ok(at >= 0, `${job.name} has no ${name} step`);
      assert.match(job.steps[at].if ?? '', /^\$\{\{ !cancelled\(\) \}\}$/, `${job.name}: the ${name} step runs only while every earlier step passed`);
      return at;
    };
    const check = index((step) => step.run === 'make ci-targets TARGETS="${{ matrix.targets }}" CI_REPORT=var/ci/${{ matrix.name }}', 'make ci-targets');
    const summary = index((step) => step.run === 'make ci-summary CI_REPORT=var/ci/${{ matrix.name }}', 'make ci-summary');
    const report = index((step) => /^actions\/upload-artifact@/.test(step.uses ?? ''), 'report upload');
    assert.ok(check < summary && summary < report, `${job.name}: the report steps follow make ci-targets`);
    assert.match(job.steps[summary].text, /CI_STEPS: \$\{\{ toJSON\(steps\) \}\}/);
    assert.match(job.steps[report].text, /path: hyper\/var\/ci\/\$\{\{ matrix\.name \}\}\/\n/);
    assert.match(job.steps[report].text, /if-no-files-found: error/);
    assert.match(job.steps[report].text, /name: ci-\$\{\{ matrix\.name \}\}-/);
    // Chromium is installed only in the entries whose targets run a browser.
    const browser = job.steps.find((step) => step.run === 'make install-browser');
    assert.match(browser?.if ?? '', /matrix\.browser/);
    for (const entry of matrixEntries(text)) {
      assert.equal(entry.browser, entry.targets.some((target) => ['parity', 'server-parity', 'server-parity-python', 'e2e'].includes(target)), `${entry.name}: browser flag`);
    }
    // The toolchain check of the recipes reads the Python of PATH, so every job sets up the Python of .python-version.
    const python = job.steps.find((step) => /^actions\/setup-python@/.test(step.uses ?? ''));
    assert.match(python?.text ?? '', /python-version-file: hyper\/\.python-version/, `${job.name}: the Python of .python-version`);
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
  const check = checkTargets();
  assert.deepEqual(darwin.filter((target) => check.includes(target)), [], 'a Darwin target in the CHECK_TARGETS of every platform');
  const commit = '0'.repeat(40);
  const line = dryRun('check', { variables: [`TEMPLATE_COMMIT=${commit}`] }).find((entry) => entry.includes(' scripts/kit/full-run.mjs run '));
  assert.ok(line, 'make check does not run scripts/kit/full-run.mjs');
  const suite = line.split(` scripts/kit/full-run.mjs run --key template=${commit} `)[1].split(' ');
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
  if (!job) return [`the job ${CI_PASSED} is missing; a release tag requires it as the check of ci.yml`];
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

test('ci-passed is the last job of ci.yml, runs always, needs every other job and runs make ci-passed (HY-95)', () => {
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

/** Each broken rule of release.yml: one job with the permission to create a release, the tag in its environment, the
 * whole history checked out, the template repository at TEMPLATE_TAG and the release steps last and in order. */
function releaseProblems(text) {
  const found = [];
  if (!/^permissions:\n {2}contents: write\n(?! )/m.test(text)) found.push('the permissions are not exactly contents: write, which gh release create needs');
  const read = jobs(text);
  if (read.map((job) => job.name).join() !== 'release') return [...found, `the jobs are ${read.map((job) => job.name).join(', ')}, not the one job release`];
  const [job] = read;
  if (!/^ {6}TAG: \$\{\{ github\.ref_name \}\}$/m.test(job.text)) found.push('the job release does not set TAG: ${{ github.ref_name }} in its environment');
  if (!/^actions\/checkout@/.test(job.steps[0].uses ?? '') || !/^ {10}fetch-depth: 0$/m.test(job.steps[0].text)) found.push('the first step is not actions/checkout with fetch-depth: 0; the ancestry check needs origin/main');
  const tag = /^TEMPLATE_TAG := (\S+)$/m.exec(readFileSync(path.join(ROOT, 'Makefile'), 'utf8'))?.[1];
  const template = job.steps.filter((step) => /^ {10}repository: polyspec\/template$/m.test(step.text));
  if (template.length !== 1 || !template[0].text.includes(`\n          ref: ${tag}\n`)) found.push(`the job release does not check out polyspec/template once at TEMPLATE_TAG ${tag}`);
  const runs = job.steps.filter((step) => step.run !== undefined).map((step) => step.run);
  if (runs.slice(-RELEASE_STEPS.length).join('\n') !== RELEASE_STEPS.join('\n')) found.push(`the steps run [${runs.join(', ')}], not the release steps [${RELEASE_STEPS.join(', ')}] last and in order`);
  return found;
}

test('release runs its steps in order with the tag, the template tag and the permission to release', () => {
  const text = readFileSync(path.join(WORKFLOWS, 'release.yml'), 'utf8');
  assert.deepEqual(releaseProblems(text), []);
  assert.deepEqual(jobs(text)[0].steps.filter((step) => step.run !== undefined).map((step) => step.run), ['make install', ...RELEASE_STEPS]);
  const broken = {
    order: [text.replace('run: make release-versions', 'run: make release-swap').replace('run: make release-verify', 'run: make release-versions').replace('run: make release-swap', 'run: make release-verify'), 'the steps run'],
    'read only': [text.replace('  contents: write\n', '  contents: read\n'), 'the permissions are not exactly contents: write'],
    'no tag': [text.replace('      TAG: ${{ github.ref_name }}\n', ''), 'the job release does not set TAG'],
    shallow: [text.replace('          fetch-depth: 0\n', '          fetch-depth: 1\n'), 'the first step is not actions/checkout with fetch-depth: 0'],
    'template ref': [text.replace(/^ {10}ref: v\d+\.\d+\.\d+\n/m, '          ref: main\n'), 'the job release does not check out polyspec/template once at TEMPLATE_TAG'],
  };
  for (const [name, [changed, message]] of Object.entries(broken)) {
    assert.notEqual(changed, text, name);
    const problems = releaseProblems(changed);
    assert.ok(problems.some((problem) => problem.startsWith(message)), `${name}: ${problems.join('; ')}`);
  }
});
