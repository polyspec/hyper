// Tests the rules of the GitHub workflows (HR-90, HR-91, HR-95): every job runs on the declared runner ubuntu-26.04-arm,
// except the jobs platform and php of assets.yml, which run on the runner of each platform of the release, because the
// asset of a platform is built and loaded on that platform alone; every action is pinned by its commit, no step or job
// has a time limit, and every step that runs a command runs one make target, so the exported settings and the checks of
// the Makefile, such as the offline settings and the toolchain check, apply to it. Every job of a workflow has exactly
// one run step, `make ci-<job>` (`make ci-assets-<job>` in assets.yml, `make ci-release-<job>` in release.yml) with make
// variables, and its other steps are uses: steps, so a local run `make ci-<job> NAME=<value>` is the call of CI (H33.1).
// The matrix of ci.yml names the CI groups of the Makefile, whose targets are the targets of CHECK_TARGETS, each once;
// the group gates runs GATE_TARGETS, the checkers of kit. ci.yml and release.yml call assets.yml, which builds the assets
// of the release, and no job calls another workflow (H35.35-1). The last job of ci.yml is ci-passed, which a release
// requires of the run whose id it takes (HR-95): it runs after every other job (`if: ${{ always() }}`), needs every
// other job of the workflow, runs on their runner and runs `make ci-passed` with the JSON of `needs`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dryRun } from './make-dry-run.mts';


const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOWS = path.join(ROOT, '.github/workflows');
const RUNNER = 'ubuntu-26.04-arm';
// The workflow of the assets of a release, which ci.yml calls for the commit of its run and release.yml for its tag, and
// the runner of each platform of the release, on which its jobs platform and php build the assets of that platform.
const ASSETS = 'assets.yml';
const ASSETS_CALL = './.github/workflows/assets.yml';
const PLATFORM_RUNNERS: Record<string, string> = { 'linux-x64-gnu': 'ubuntu-26.04', 'linux-arm64-gnu': 'ubuntu-26.04-arm', 'darwin-arm64': 'macos-15' };
const MATRIX_RUNNER = '${{ matrix.runner }}';
const CI_PASSED = 'ci-passed';
const CI_PASSED_RUN = "make ci-passed RESULTS='${{ toJSON(needs) }}' FAIL_SKIPPED=1";
// The bootstrap of hyper: the action of .github/actions/bootstrap, which sets up the Node.js of mise.toml and installs the lock,
// the npm of devEngines and the packages of package-lock.json. Every job that runs steps runs it right after its checkout, at
// the workspace root.
const BOOTSTRAP_ACTION = './.github/actions/bootstrap';

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

// The workflows of this repository, each a file of hyper.
const workflows = () => readdirSync(WORKFLOWS).filter((name) => name.endsWith('.yml')).map((name) => ({ name, text: readFileSync(path.join(WORKFLOWS, name), 'utf8') }));
const allWorkflows = workflows;
// A job with `uses:` runs the jobs of another workflow: the job assets of ci.yml and of release.yml calls assets.yml,
// and every other job runs its own steps.
const calls = (job: Job) => /^ {4}uses: /m.test(job.text);

/** The entries of the matrix of a job, read from the block layout: an entry is an item at indent 10 and its keys are at indent 12. */
function jobMatrix(job: Job): Record<string, string>[] {
  const entries: Record<string, string>[] = [];
  for (const line of job.text.split('\n')) {
    const key = /^ {10}(- | {2})([\w-]+): (.*)$/.exec(line);
    if (!key) continue;
    if (key[1] === '- ') entries.push({});
    const last = entries.at(-1);
    if (last) last[group(key, 2)] = group(key, 3).replace(/^'(.*)'$/, '$1');
  }
  return entries;
}

/**
 * Each broken rule of the runner of a job: ubuntu-26.04-arm, or, for a job of assets.yml that builds per platform, the
 * runner of its matrix entry, which is the runner of the platform of that entry.
 */
function runnerProblems(workflow: string, job: Job): string[] {
  const runner = /^ {4}runs-on: (.*)$/m.exec(job.text)?.[1];
  if (runner === RUNNER) return [];
  if (workflow !== ASSETS || runner !== MATRIX_RUNNER) return [`${workflow} ${job.name}: runs-on is not ${RUNNER}`];
  const entries = jobMatrix(job);
  const found = entries.filter((entry) => entry['platform'] === undefined || PLATFORM_RUNNERS[entry['platform']] !== entry['runner']).map((entry) => `${workflow} ${job.name}: the matrix entry ${entry['platform']} runs on ${entry['runner']}, not on the runner of its platform`);
  const missing = Object.keys(PLATFORM_RUNNERS).filter((platform) => !entries.some((entry) => entry['platform'] === platform));
  return missing.length ? [...found, `${workflow} ${job.name}: the matrix lacks the platforms ${missing.join(', ')}`] : found;
}

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
      found.push(...runnerProblems(workflow.name, job));
      for (const step of job.steps) {
        // A local action of the checkout (./) is a file of this commit, so no commit pin applies to it.
        if (step.uses === undefined || step.uses === '' || step.uses.startsWith('./')) continue;
        if (!/^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v?\d/.test(step.uses)) found.push(`${workflow.name} ${job.name}: ${step.uses} is not pinned by a commit with its release`);
      }
    }
  }
  assert.deepEqual(found, []);
  // A job of another workflow on another runner, a platform on the runner of another platform and a missing platform are found.
  const platform = (entries: string) => item(jobs(`jobs:\n  platform:\n    strategy:\n      matrix:\n        include:\n${entries}    runs-on: \${{ matrix.runner }}\n`), 0, 'the jobs');
  const all = Object.entries(PLATFORM_RUNNERS).map(([name, runner]) => `          - platform: ${name}\n            runner: ${runner}\n`).join('');
  assert.deepEqual(runnerProblems(ASSETS, platform(all)), []);
  assert.equal(runnerProblems('ci.yml', platform(all)).length, 1);
  assert.equal(runnerProblems(ASSETS, platform(all.replace('macos-15', 'ubuntu-26.04'))).length, 1);
  assert.equal(runnerProblems(ASSETS, platform(all.split('          - platform: darwin-arm64')[0] ?? '')).length, 1);
});

test('every step that runs a command runs one make, right after the bootstrap of the checkout (HR-90)', () => {
  const found: string[] = [];
  for (const workflow of workflows()) {
    for (const job of jobs(workflow.text).filter((job) => !calls(job))) {
      assert.ok(job.steps.length > 0, `${workflow.name} ${job.name} has no step`);
      // The bootstrap action of kit runs right after the checkout of the job.
      if (!(job.steps[0]?.uses ?? '').startsWith('actions/checkout@') || job.steps[1]?.uses !== BOOTSTRAP_ACTION) found.push(`${workflow.name} ${job.name}: the second step is not uses: ${BOOTSTRAP_ACTION} after the checkout`);
      for (const step of job.steps) {
        if (step.run !== undefined && !/^make [^|&;<>`$\n]*(\$\{\{ [^}]+ \}\}[^|&;<>`$\n]*)*$/.test(step.run)) found.push(`${workflow.name} ${job.name}: the step "${step.run}" runs a command other than one make`);
      }
    }
  }
  assert.deepEqual(found, []);
});

// The workflows of this repository, whose jobs hold one call of a recipe each (HR-90): the release among them, whose recipe
// runs its steps in order.
const CI_WORKFLOWS = ['ci.yml', 'release.yml', ASSETS];
// The recipe of a job is make ci-<job>; a job of assets.yml runs make ci-assets-<job> and a job of release.yml
// make ci-release-<job>, so that the two workflows may name a job alike.
const RECIPE_PREFIX: Record<string, string> = { [ASSETS]: 'ci-assets-', 'release.yml': 'ci-release-' };
// The judgement job of ci.yml, which reads the results of the other jobs and so exists only in CI: its run step may pass
// the JSON of `needs`, the one expression besides a matrix value.
const JUDGEMENT: Record<string, string> = { [CI_PASSED]: "RESULTS='${{ toJSON(needs) }}'" };

/**
 * Each broken rule of the shape of the jobs of a CI workflow (HR-90): a job has exactly one `run:` step, `make ci-<job>`
 * (the job ci-passed runs `make ci-passed`), whose arguments are make variables `NAME=value`, a value being a word or a
 * matrix value `${{ matrix.<key> }}`; the run step has no `if:`, no `env:` and no other key that carries an expression;
 * every other step is a `uses:` step, and a step after the run step carries its result, so it runs after a failed step
 * (`if: ${{ !cancelled() }}`).
 */
function jobShapeProblems(name: string, text: string): string[] {
  const found: string[] = [];
  for (const job of jobs(text).filter((job) => !calls(job))) {
    const at = `${name} ${job.name}`;
    const runs = job.steps.filter((step) => step.run !== undefined);
    if (runs.length !== 1) {
      found.push(`${at}: ${runs.length} run steps, not exactly one make ci-${job.name}`);
      continue;
    }
    const run = item(runs, 0, `the run steps of ${at}`);
    const target = job.name.startsWith('ci-') ? job.name : `${RECIPE_PREFIX[name] ?? 'ci-'}${job.name}`;
    // The words of the run line, an expression or a quoted value being part of its word.
    const [command, called, ...words] = (run.run ?? '').match(/(?:\$\{\{ [^}]* \}\}|'[^']*'|"[^"]*"|[^\s'"])+/g) ?? [];
    const judgement = JUDGEMENT[job.name];
    // A value is a word, a matrix value, an input of a called workflow or an output of a needed job; the job tag of
    // release.yml alone reads the event, in a quoted expression, since the event names the run that it tags.
    const event = name === 'release.yml' && job.name === 'tag';
    const argument = (word: string) => /^[A-Z][A-Z0-9_]*=(?:[\w./-]+|\$\{\{ (?:matrix|inputs)\.[\w-]+ \}\}|\$\{\{ needs\.[\w-]+\.outputs\.[\w-]+ \}\})$/.test(word) || word === judgement || (event && /^[A-Z][A-Z0-9_]*="\$\{\{ [^"}]* \}\}"$/.test(word));
    if (command !== 'make' || called !== target) found.push(`${at}: the run step is "${run.run}", not make ${target}`);
    const bad = words.filter((word) => !argument(word));
    if (bad.length) found.push(`${at}: the run step passes ${bad.join(' ')}, not make variables of a word or a matrix value`);
    if (run.if !== undefined) found.push(`${at}: the run step has if: ${run.if}; the recipe ${target} holds the conditions`);
    const keys = run.text.split('\n').map((line) => /^ {8}([\w-]+):/.exec(line)?.[1]).filter((key) => key !== undefined && !['run', 'id', 'name'].includes(key));
    if (keys.length) found.push(`${at}: the run step has ${keys.join(', ')}; it passes its values as make variables`);
    const index = job.steps.indexOf(run);
    job.steps.forEach((step, position) => {
      if (step === run) return;
      if (step.uses === undefined) found.push(`${at}: step ${position + 1} is no uses: step`);
      else if (position > index && step.if !== '${{ !cancelled() }}') found.push(`${at}: step ${position + 1} carries the result of the run step and has if: ${step.if}, not \${{ !cancelled() }}`);
    });
  }
  return found;
}

test('H33.1 every job of a CI workflow has exactly one run step, make ci-<job> with make variables (HR-90)', () => {
  assert.deepEqual(workflows().filter((workflow) => CI_WORKFLOWS.includes(workflow.name)).flatMap((workflow) => jobShapeProblems(workflow.name, workflow.text)), []);
  assert.deepEqual(workflows().map((workflow) => workflow.name).filter((name) => !CI_WORKFLOWS.includes(name)), [], 'a workflow is not checked for the shape of its jobs');
  // Each broken shape is found.
  const job = (steps: string) => `jobs:\n  check:\n    runs-on: x\n    steps:\n      - uses: actions/checkout@c\n${steps}`;
  const upload = '      - uses: actions/upload-artifact@c\n        if: ${{ !cancelled() }}\n';
  const broken: Record<string, [string, string]> = {
    'two run steps': [job('      - run: make install-tools\n      - run: make ci-check NAME=gates\n'), '2 run steps'],
    'another target': [job('      - run: make ci-targets TARGETS=gates\n'), 'the run step is'],
    'a quoted list': [job('      - run: make ci-check TOOLS="${{ matrix.tools }}"\n'), 'the run step passes'],
    'an expression': [job('      - run: make ci-check NAME=${{ github.run_id }}\n'), 'the run step passes'],
    'a condition': [job('      - run: make ci-check NAME=gates\n        if: ${{ !cancelled() }}\n'), 'the run step has if'],
    'an env': [job('      - run: make ci-check NAME=gates\n        env:\n          STEPS: ${{ toJSON(steps) }}\n'), 'the run step has env'],
    'a needs JSON in a check job': [job("      - run: make ci-check RESULTS='${{ toJSON(needs) }}'\n"), 'the run step passes'],
    'a report that stops': [job('      - run: make ci-check NAME=gates\n      - uses: actions/upload-artifact@c\n'), 'step 3 carries the result'],
  };
  for (const [label, [text, message]] of Object.entries(broken)) {
    const problems = jobShapeProblems('ci.yml', text);
    assert.ok(problems.some((problem) => problem.startsWith(`ci.yml check: ${message}`)), `${label}: ${problems.join('; ')}`);
  }
  assert.deepEqual(jobShapeProblems('ci.yml', job(`      - run: make ci-check NAME=\${{ matrix.name }}\n${upload}`)), []);
});

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

/**
 * The entries of the matrix of ci.yml, read from the block layout: an entry is an item `- name: <name>` at indent 10 and its
 * keys are at indent 12. Returns the name and the other keys of each entry.
 */
interface MatrixEntry { name: string; keys: Record<string, string> }

function matrixEntries(text: string): MatrixEntry[] {
  const entries: { name: string; keys: Record<string, string> }[] = [];
  for (const line of text.split('\n')) {
    const named = /^ {10}- name: (\S+)$/.exec(line);
    if (named) { entries.push({ name: group(named, 1), keys: {} }); continue; }
    const key = /^ {12}(\w+): (.*)$/.exec(line);
    const last = entries.at(-1);
    if (key && last) last.keys[group(key, 1)] = group(key, 2).replace(/^'(.*)'$/, '$1');
  }
  return entries;
}

// The words of the simple variable `name` of the Makefile, with each $(<variable>) of its value replaced by the words of
// that variable.
function makeWords(makefile: string, name: string): string[] {
  const value = new RegExp(`^${name} := (.*)$`, 'm').exec(makefile)?.[1];
  if (value === undefined) throw new Error(`the Makefile declares no ${name}`);
  return value.split(' ').filter(Boolean).flatMap((word) => {
    const variable = /^\$\((\w+)\)$/.exec(word)?.[1];
    return variable === undefined ? [word] : makeWords(makefile, variable);
  });
}

// CHECK_TARGETS of the Makefile without the targets of one platform.
function checkTargets(): string[] {
  return makeWords(readFileSync(path.join(ROOT, 'Makefile'), 'utf8'), 'CHECK_TARGETS');
}

// The words of the CI group variable `name` of the group `group`, such as CI_TARGETS_gates.
const groupWords = (makefile: string, name: string, group: string) => makeWords(makefile, `${name}_${group}`);

test('H33.1 the matrix of ci.yml names the CI groups of the Makefile, whose targets are every target of the full suite once (HR-91)', () => {
  const makefile = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  const groups = makeWords(makefile, 'CI_GROUPS');
  const entries = matrixEntries(readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8'));
  assert.ok(groups.length > 1, groups.join(' '));
  assert.equal(new Set(groups).size, groups.length, 'a CI group repeats; the reports of two entries would share one artifact');
  assert.deepEqual(entries.map((entry) => entry.name), groups, 'the matrix entries of ci.yml are not the CI_GROUPS of the Makefile, in their order');
  // An entry holds its name and, for the setup-php step, whether its tools hold PHP; the Makefile holds the rest.
  for (const entry of entries) {
    assert.deepEqual(Object.keys(entry.keys).filter((key) => key !== 'php'), [], `the entry ${entry.name} declares keys that belong to the Makefile`);
    assert.equal(entry.keys['php'] === 'true', groupWords(makefile, 'CI_TOOLS', entry.name).includes('php'), `the entry ${entry.name} sets up PHP, or does not, against CI_TOOLS_${entry.name}`);
  }
  // A measurement group (CI_GROUPS_MEASURE) reports and never fails, so its targets belong to no check (H35.91).
  const measure = makeWords(makefile, 'CI_GROUPS_MEASURE');
  const all = groups.filter((group) => !measure.includes(group)).flatMap((group) => groupWords(makefile, 'CI_TARGETS', group));
  assert.equal(new Set(all).size, all.length, `a target runs in two CI groups: ${all.join(' ')}`);
  assert.deepEqual([...all].sort(), [...checkTargets()].sort(), 'the targets of the CI groups that check are not the targets of CHECK_TARGETS, each once');
  assert.deepEqual(groupWords(makefile, 'CI_TARGETS', 'gates'), makeWords(makefile, 'GATE_TARGETS'), 'the group gates does not run GATE_TARGETS');
});

test('a CI group checks the Rust core and the bindings (H35.2)', () => {
  const makefile = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  const targets = ['core-test', 'core-lint', 'core-fmt-check', 'bindings-check', 'test-bindings'];
  assert.deepEqual(targets.filter((target) => !checkTargets().includes(target)), [], 'CHECK_TARGETS runs every target of the core and the bindings');
  assert.deepEqual(groupWords(makefile, 'CI_TARGETS', 'core'), targets, 'the group core runs the targets of the core and the bindings');
});

test('the CI group bench of ci.yml measures the benchmarks with Redis on every run (H35.91)', () => {
  const makefile = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  assert.ok(makeWords(makefile, 'CI_GROUPS').includes('bench'), 'CI_GROUPS lacks the group bench, so no run of ci.yml measures the benchmarks');
  assert.ok(makeWords(makefile, 'CI_GROUPS_MEASURE').includes('bench'), 'CI_GROUPS_MEASURE does not declare the group bench a measurement');
  const measured = makeWords(makefile, 'CI_GROUPS_MEASURE').flatMap((group) => groupWords(makefile, 'CI_TARGETS', group));
  assert.deepEqual(measured.filter((target) => checkTargets().includes(target)), [], 'CHECK_TARGETS holds a target of a measurement group, which never fails');
  assert.deepEqual(groupWords(makefile, 'CI_TARGETS', 'bench'), ['bench', 'bench-sessions'], 'the group bench runs bench and bench-sessions');
  assert.ok(groupWords(makefile, 'CI_SETUP', 'bench').includes('hyper-install-redis'), 'the setup of the group bench installs no Redis, which bench-sessions needs');
  assert.equal(existsSync(path.join(WORKFLOWS, 'bench.yml')), false, 'bench.yml runs the group bench a second time on a manual run');
});

/**
 * The order of the call that a job makes (HR-90, HR-91), read from the dry run of the recipe: each setup step of the group
 * with its make variables, then `make ci-targets` with the targets of the group and its report var/ci/<group>, then
 * `make ci-summary` of that report with the outcome of each setup step. Returns the broken rules.
 */
function ciRunProblems(goal: string, group: string, makefile: string): string[] {
  const lines = dryRun(goal, { variables: goal === 'ci-check' ? [`NAME=${group}`] : [] }).join('\n');
  const tools = groupWords(makefile, 'CI_TOOLS', group).join(' ');
  // A group without install-symbols declares no CI_SYMBOLS.
  const symbols = new RegExp(`^CI_SYMBOLS_${group} := `, 'm').test(makefile) ? groupWords(makefile, 'CI_SYMBOLS', group).join(' ') : '';
  const argumentsOf: Record<string, string> = { 'install-tools': ` TOOLS="${tools}"`, 'install-symbols': ` EXTRACTORS="${symbols}"` };
  const expected = [
    ...groupWords(makefile, 'CI_SETUP', group).map((step) => ` ${step}${argumentsOf[step] ?? ''};`),
    ` ci-targets TARGETS="${groupWords(makefile, 'CI_TARGETS', group).join(' ')}" CI_REPORT=var/ci/${group} `,
    // H35.46: the report holds the case results of the recipe runners, which name each failed case (HR-84).
    ` ci-results CI_REPORT=var/ci/${group} `,
    ` ci-summary CI_REPORT=var/ci/${group} `,
  ];
  const found: string[] = [];
  let from = 0;
  for (const part of expected) {
    const at = lines.indexOf(part, from);
    if (at < 0) found.push(`make -n ${goal}${goal === 'ci-check' ? ` NAME=${group}` : ''} does not run "${part.trim()}" after the parts before it: ${lines}`);
    else from = at + part.length;
  }
  return found;
}

test('H33.1 make ci-check NAME=<group> runs the setup, the targets and the report of the group in order (HR-90)', () => {
  const makefile = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  const groups = makeWords(makefile, 'CI_GROUPS');
  assert.deepEqual(groups.flatMap((group) => ciRunProblems('ci-check', group, makefile)), []);
  // A NAME that names no group fails before any step runs, naming the groups.
  const unknown = spawnSync('make', ['--no-print-directory', '-n', 'ci-check', 'NAME=nope'], { cwd: ROOT, encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL', 'MAKEOVERRIDES'].includes(name))) });
  assert.notEqual(unknown.status, 0, unknown.stdout);
  assert.match(unknown.stderr, new RegExp(`NAME=nope names no CI group of CI_GROUPS: ${groups.join(' ')}`));
});

test('H35.35-7 make go-release-build builds and vets packages/go alone with the go of the checkout, and make ci-release publishes the Go module before the draft', () => {
  const build = dryRun('go-release-build').join('\n');
  const go = `${ROOT}/var/tools/mise/shims/go`;
  for (const command of ['build -mod=readonly ./...', 'vet ./...']) {
    assert.ok(build.includes(`cd packages/go && GOWORK=off GOTOOLCHAIN=local ${go} ${command}`), `make -n go-release-build runs no "${command}" of ${go} with GOWORK=off in packages/go: ${build}`);
  }
  assert.ok(dryRun('test-bindings').join('\n').includes('-mod=readonly ./...'), 'make test-bindings runs no go-release-build');
  // The job release pushes the tag of the Go module after release-go-module made it, and before the public release.
  assert.deepEqual(makeOrderProblems('ci-release-release', ['TAG=v0.0.0', 'VERSION=0.0.0'], [started('release-go-module'), started('release-go-module-push'), started('release-platform-assets'), started('release-undraft')]), []);
});

test('H35.46 make ci-results copies the case results of the recipe runners into the report, and passes without them (HR-84, HR-91)', (t) => {
  const work = mkdtempSync(path.join(tmpdir(), 'hyper-ci-results-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const results = path.join(work, 'results');
  const report = path.join(work, 'report');
  mkdirSync(report);
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL', 'MAKEOVERRIDES'].includes(name)));
  const run = () => spawnSync('make', ['--no-print-directory', 'ci-results', `RECIPE_RESULTS_DIR=${results}`, `CI_REPORT=${report}`], { cwd: ROOT, encoding: 'utf8', env });
  // A group whose targets run no recipe runner writes no results; its report is complete without them.
  const none = run();
  assert.equal(none.status, 0, `${none.stdout}${none.stderr}`);
  assert.deepEqual(readdirSync(report), []);
  mkdirSync(results);
  const failed = 'CASE browser.json render r1 FAIL expected <p>, got <div>\n';
  writeFileSync(path.join(results, 'browser.txt'), failed);
  writeFileSync(path.join(results, 'node.txt'), 'CASE node.json reads r1 PASS\n');
  const copied = run();
  assert.equal(copied.status, 0, `${copied.stdout}${copied.stderr}`);
  assert.deepEqual(readdirSync(path.join(report, 'recipe-results')).sort(), ['browser.txt', 'node.txt']);
  assert.equal(readFileSync(path.join(report, 'recipe-results', 'browser.txt'), 'utf8'), failed);
});

/** The makes of `steps` that the dry run of `goal` does not start in their order, each a make of its own. */
function makeOrderProblems(goal: string, variables: string[], steps: string[]): string[] {
  const lines = `${dryRun(goal, { variables, env: { ...process.env, GITHUB_ENV: '/dev/null', GITHUB_ACTOR: 'actor' } }).join('\n')}\n`;
  const found: string[] = [];
  let from = 0;
  for (const step of steps) {
    const at = lines.indexOf(step, from);
    if (at < 0) found.push(`make -n ${goal} ${variables.join(' ')} does not run "${step.trim()}" after the steps before it: ${lines}`);
    else from = at + step.length;
  }
  return found;
}

// The make that a recipe of a job starts for the target `target`.
const started = (target: string) => ` --no-print-directory ${target}\n`;

test('H35.35-1 the release tags the commit of the CI run, builds the assets of the tag with assets.yml and then publishes (HR-95)', () => {
  const release = jobs(readFileSync(path.join(WORKFLOWS, 'release.yml'), 'utf8'));
  assert.deepEqual(release.map((job) => job.name), ['tag', 'assets', 'release']);
  const assets = item(release, 1, 'the jobs of release.yml');
  // The job assets builds the tree of the tag that the job tag made, with the release check of binding, and runs only
  // when a tag was made; the job release publishes what it built.
  for (const line of [`    uses: ${ASSETS_CALL}`, '    needs: tag', "    if: ${{ needs.tag.outputs.tag != '' }}", '      ref: ${{ needs.tag.outputs.tag }}', '      release: true']) assert.ok(assets.text.split('\n').includes(line), `the job assets of release.yml lacks the line "${line.trim()}"`);
  assert.ok(item(release, 2, 'the jobs of release.yml').text.split('\n').includes('    needs: [tag, assets]'), 'the job release of release.yml does not need the jobs tag and assets');
  // The job tag runs release-tag and gives its tag to the later jobs; a dispatch or a local run passes no AUTO.
  assert.deepEqual(makeOrderProblems('ci-release-tag', ['RUN=1', 'AUTO=1'], [started('release-tag'), ' --no-print-directory release-tag-output ']), []);
  assert.match(dryRun('release-tag', { variables: ['RUN=1', 'AUTO=1'] }).join('\n'), /\/release-run\.m[jt]s tag "\$RUN" --auto$/m);
  assert.ok(!dryRun('release-tag', { variables: ['RUN=1', 'AUTO='] }).join('\n').includes('--auto'), 'a dispatch or a local run releases with --auto');
  // The job release: the archives of kit and the draft, then the assets of each platform that the workflow downloaded,
  // with their folders, the Go module, the upload of the platform assets and the public release.
  assert.deepEqual(makeOrderProblems('ci-release-release', ['TAG=v0.0.0', 'VERSION=0.0.0'], [started('release-tools'), started('release-assets'), started('release-publish'), 'cp -R var/release/downloaded/. var/release/assets/\n', started('release-recipes'), started('release-go-module'), started('release-platform-assets'), started('release-undraft')]), []);
});

test('H35.35-1 every CI run builds the assets with the recipes of the release, and each recipe checks the bindings before it builds', () => {
  const ci = jobs(readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8'));
  const called = ci.find((job) => job.name === 'assets');
  assert.ok(called !== undefined, 'ci.yml has no job assets');
  assert.ok(called.text.split('\n').includes(`    uses: ${ASSETS_CALL}`), 'the job assets of ci.yml does not call assets.yml');
  assert.ok(!/^ {6}release:/m.test(called.text), 'the job assets of ci.yml passes release, which is the input of a release alone');
  const assets = jobs(readFileSync(path.join(WORKFLOWS, ASSETS), 'utf8'));
  assert.deepEqual(assets.map((job) => job.name), ['platform', 'php', 'npm']);
  for (const job of assets) {
    const run = job.steps.find((step) => step.run !== undefined)?.run ?? '';
    assert.ok(run.endsWith(' RELEASE=${{ inputs.release }}'), `assets.yml ${job.name}: the run step "${run}" does not pass RELEASE=\${{ inputs.release }}`);
    assert.ok(job.text.includes('          ref: ${{ inputs.ref }}'), `assets.yml ${job.name}: the checkout does not take the ref of the caller`);
    const variables = job.name === 'php' ? ['EXPECTED_PHP_MINOR=8.4'] : [];
    const build = started(`release-assets-${job.name}`).trimEnd();
    // Without RELEASE the recipe runs the check of binding that CI runs, with RELEASE=true the check of a release; both
    // start go, which the recipe installs first, and both come before the build.
    assert.deepEqual(makeOrderProblems(`ci-assets-${job.name}`, variables, [' install-tools TOOLS=', started('release-recipes'), started('bindings-check'), build]), []);
    assert.deepEqual(makeOrderProblems(`ci-assets-${job.name}`, [...variables, 'RELEASE=true'], [' install-tools TOOLS=', started('release-recipes'), started('release-binding-check'), build]), []);
    const plain = dryRun(`ci-assets-${job.name}`, { variables }).join('\n');
    assert.ok(!plain.includes(started('release-binding-check').trimEnd()), `make ci-assets-${job.name} runs the release check without RELEASE=true`);
    assert.match(/ install-tools TOOLS="([^"]*)"/.exec(plain)?.[1] ?? '', /\bgo\b/, `make ci-assets-${job.name} installs no go before the check of binding, which starts it`);
  }
});

test('H35.35-1 a CI group builds the archives of the release from the committed HEAD with no tag (kit K1286)', () => {
  assert.ok(checkTargets().includes('release-candidate-assets'), 'CHECK_TARGETS does not run release-candidate-assets');
  const lines = dryRun('release-candidate-assets').join('\n');
  assert.match(lines, /RELEASE_ASSETS=var\/release-candidate\/assets .*\/release\.m[jt]s candidate-assets$/m, lines);
  // The rehearsal of the version commit on a clean clone builds the same archives for the version that it is given.
  const rehearsal = dryRun('release-rehearsal', { variables: ['VERSION=0.0.1'] }).join('\n');
  assert.match(rehearsal, /RELEASE_ASSETS=var\/release-candidate\/assets .*\/release-run\.m[jt]s prepare "0\.0\.1"$/m, rehearsal);
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
  if (runs.join('\n') !== CI_PASSED_RUN || job.steps.at(-1)?.run !== CI_PASSED_RUN) found.push(`the job ${CI_PASSED} runs [${runs.join(', ')}], not the one last step ${CI_PASSED_RUN}`);
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
    'needs no job': [text.replace('    needs: [check, assets]\n', '    needs: []\n'), 'the job ci-passed needs [], not every other job [check, assets]'],
    'needs no assets': [text.replace('    needs: [check, assets]\n', '    needs: [check]\n'), 'the job ci-passed needs [check], not every other job [check, assets]'],
    'another runner': [text.replace('    needs: [check, assets]\n    runs-on: ubuntu-26.04-arm\n', '    needs: [check, assets]\n    runs-on: ubuntu-24.04\n'), 'the job ci-passed runs on ubuntu-24.04, not on the runner of the other jobs'],
    'another step': [text.replace(CI_PASSED_RUN, 'make ci-passed'), 'the job ci-passed runs [make ci-passed], not the one last step'],
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
 * of naming a PHP itself, so the jobs of CI start the same PHP (kit K193). The job php of assets.yml alone names the PHP
 * of its matrix entry, `php-version: ${{ matrix.php }}`, since it builds the extension once for each PHP minor.
 */
function phpVersionProblems(phpVersion: string, files: { name: string; text: string }[]): string[] {
  const found: string[] = [];
  if (!/^\d+\.\d+\n$/.test(phpVersion)) found.push(`.php-version holds ${JSON.stringify(phpVersion)}, not one minor release such as 8.5`);
  for (const workflow of files) {
    for (const job of jobs(workflow.text)) {
      for (const step of job.steps) {
        if (!step.uses?.startsWith('shivammathur/setup-php@')) continue;
        if (workflow.name === ASSETS && job.name === 'php' && step.text.split('\n').includes('          php-version: ${{ matrix.php }}')) continue;
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


// kit 0.0.98 includes no recipe into a repository (kit docs/spec/utilities-and-recipes.md): the Makefile holds every target
// that its recipes and workflows run, and no workflow calls a workflow that kit wrote.
test('H27.83 the Makefile includes no file of kit, and every make target of a workflow is a target of the Makefile', () => {
  const makefile = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  // The one include is packages/release.mk, the release recipes that binding writes (HR-99), which is no file of kit.
  assert.deepEqual(makefile.split('\n').filter((line) => /^-?include\b/.test(line)), ['-include $(CURDIR)/packages/release.mk'], 'the Makefile includes a file');
  const defined = new Set([...makefile.matchAll(/^([a-z][\w-]*(?: [a-z][\w-]*)*):(?!=)/gm)].flatMap((match) => (match[1] ?? '').split(' ')));
  const action = readFileSync(path.join(ROOT, '.github/actions/bootstrap/action.yml'), 'utf8');
  const called = [...workflows().map((workflow) => workflow.text), action].flatMap((text) => [...text.matchAll(/^\s*(?:- )?run: make ([a-z][\w-]*)/gm)].map((match) => match[1] ?? ''));
  assert.ok(called.includes('ci-check') &&called.includes('ci-release-tag') && called.includes('ci-release-release') && called.includes('ci-assets-platform') && called.includes('bootstrap'), called.join(' '));
  assert.deepEqual([...new Set(called)].filter((target) => !defined.has(target)), [], 'a workflow runs a target that the Makefile does not define');
  // The one called workflow is assets.yml of this repository, which the job assets of ci.yml and of release.yml calls.
  const callers = workflows().flatMap((workflow) => jobs(workflow.text).filter(calls).map((job) => `${workflow.name} ${job.name}: ${/^ {4}uses: (.*)$/m.exec(job.text)?.[1]}`));
  assert.deepEqual(callers.sort(), [`ci.yml assets: ${ASSETS_CALL}`, `release.yml assets: ${ASSETS_CALL}`], 'a job calls another workflow than assets.yml');
});

