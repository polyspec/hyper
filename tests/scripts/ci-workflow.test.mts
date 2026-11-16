// Tests the rules of the GitHub workflows (HR-90, HR-91, HR-95): every job runs on the declared runner ubuntu-26.04-arm,
// every action is pinned by its commit, no step or job has a time limit, and every step that runs a command runs one make
// target, so the exported settings and the checks of the Makefile, such as the offline settings and the toolchain check,
// apply to it. Every job of a workflow that CI runs (ci.yml, bench.yml) has exactly one run step, `make ci-<job>` with
// make variables, and its other steps are uses: steps, so a local run `make ci-<job> NAME=<value>` is the call of CI
// (H33.1). The matrix of ci.yml names the CI groups of the Makefile, whose targets are the targets of CHECK_TARGETS, each
// once; the group gates runs GATE_TARGETS, the checkers of kit, and no job calls another workflow. The last job of ci.yml
// is ci-passed, which a release requires of the run whose id it takes (HR-95): it runs after every other job
// (`if: ${{ always() }}`), needs every other job of the workflow, runs on their runner and runs `make ci-passed` with the
// JSON of `needs`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dryRun } from './make-dry-run.mts';


const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOWS = path.join(ROOT, '.github/workflows');
const RUNNER = 'ubuntu-26.04-arm';
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
// A job with `uses:` runs the jobs of another workflow; no job of hyper calls one, so each job runs its own steps.
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
        // A local action of the checkout (./) is a file of this commit, so no commit pin applies to it.
        if (step.uses === undefined || step.uses === '' || step.uses.startsWith('./')) continue;
        if (!/^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v?\d/.test(step.uses)) found.push(`${workflow.name} ${job.name}: ${step.uses} is not pinned by a commit with its release`);
      }
    }
  }
  assert.deepEqual(found, []);
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
const CI_WORKFLOWS = ['ci.yml', 'bench.yml', 'release.yml'];
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
    const target = job.name.startsWith('ci-') ? job.name : `ci-${job.name}`;
    // The words of the run line, an expression or a quoted value being part of its word.
    const [command, called, ...words] = (run.run ?? '').match(/(?:\$\{\{ [^}]* \}\}|'[^']*'|[^\s'])+/g) ?? [];
    const judgement = JUDGEMENT[job.name];
    const argument = (word: string) => /^[A-Z][A-Z0-9_]*=(?:[\w./-]+|\$\{\{ matrix\.[\w-]+ \}\})$/.test(word) || word === judgement;
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
  const all = groups.flatMap((group) => groupWords(makefile, 'CI_TARGETS', group));
  assert.equal(new Set(all).size, all.length, `a target runs in two CI groups: ${all.join(' ')}`);
  assert.deepEqual([...all].sort(), [...checkTargets()].sort(), 'the targets of the CI groups are not the targets of CHECK_TARGETS, each once');
  assert.deepEqual(groupWords(makefile, 'CI_TARGETS', 'gates'), makeWords(makefile, 'GATE_TARGETS'), 'the group gates does not run GATE_TARGETS');
});

test('a CI group checks the Rust core and the bindings (H35.2)', () => {
  const makefile = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  const targets = ['core-test', 'core-lint', 'core-fmt-check', 'bindings-check', 'test-bindings'];
  assert.deepEqual(targets.filter((target) => !checkTargets().includes(target)), [], 'CHECK_TARGETS runs every target of the core and the bindings');
  assert.deepEqual(groupWords(makefile, 'CI_TARGETS', 'core'), targets, 'the group core runs the targets of the core and the bindings');
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

test('H33.1 make ci-check NAME=<group> and make ci-bench run the setup, the targets and the report of the group in order (HR-90)', () => {
  const makefile = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  const groups = makeWords(makefile, 'CI_GROUPS');
  assert.deepEqual([...groups.flatMap((group) => ciRunProblems('ci-check', group, makefile)), ...ciRunProblems('ci-bench', 'bench', makefile)], []);
  assert.deepEqual(groupWords(makefile, 'CI_TARGETS', 'bench'), ['bench', 'bench-sessions']);
  // make ci-release tags first, with AUTO=1 for a workflow_run, reads TAG, then runs every later step in order, each after
  // the one before it passed.
  const release = dryRun('ci-release', { variables: ['GITHUB_EVENT_NAME=workflow_run'] }).join('\n');
  let from = release.indexOf(' release-tag AUTO=1 ');
  assert.ok(from >= 0, release);
  for (const step of [' . ./var/release/tag.env ', 'test -z "$TAG"', ...makeWords(makefile, 'RELEASE_STEPS').map((step) => ` ${step}${step === 'install-tools' ? ' TOOLS=npm' : ''} &&`)]) {
    const at = release.indexOf(step, from);
    assert.ok(at > from, `make -n ci-release does not run "${step.trim()}" after the steps before it: ${release}`);
    from = at;
  }
  assert.ok(!dryRun('ci-release').join('\n').includes('AUTO=1'), 'a dispatch or a local run releases with AUTO');
  // A NAME that names no group fails before any step runs, naming the groups.
  const unknown = spawnSync('make', ['--no-print-directory', '-n', 'ci-check', 'NAME=nope'], { cwd: ROOT, encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL', 'MAKEOVERRIDES'].includes(name))) });
  assert.notEqual(unknown.status, 0, unknown.stdout);
  assert.match(unknown.stderr, new RegExp(`NAME=nope names no CI group of CI_GROUPS: ${groups.join(' ')}`));
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
    'needs no job': [text.replace('    needs: [check]\n', '    needs: []\n'), 'the job ci-passed needs [], not every other job [check]'],
    'another runner': [text.replace('    needs: [check]\n    runs-on: ubuntu-26.04-arm\n', '    needs: [check]\n    runs-on: ubuntu-24.04\n'), 'the job ci-passed runs on ubuntu-24.04, not on the runner of the other jobs'],
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


// kit 0.0.98 includes no recipe into a repository (kit docs/spec/utilities-and-recipes.md): the Makefile holds every target
// that its recipes and workflows run, and no workflow calls a workflow that kit wrote.
test('H27.83 the Makefile includes no file of kit, and every make target of a workflow is a target of the Makefile', () => {
  const makefile = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  // The one include is packages/release.mk, the release recipes that binding writes (HR-99), which is no file of kit.
  assert.deepEqual(makefile.split('\n').filter((line) => /^-?include\b/.test(line)), ['-include $(CURDIR)/packages/release.mk'], 'the Makefile includes a file');
  const defined = new Set([...makefile.matchAll(/^([a-z][\w-]*(?: [a-z][\w-]*)*):(?!=)/gm)].flatMap((match) => (match[1] ?? '').split(' ')));
  const action = readFileSync(path.join(ROOT, '.github/actions/bootstrap/action.yml'), 'utf8');
  const called = [...workflows().map((workflow) => workflow.text), action].flatMap((text) => [...text.matchAll(/^\s*(?:- )?run: make ([a-z][\w-]*)/gm)].map((match) => match[1] ?? ''));
  assert.ok(called.includes('ci-check') && called.includes('ci-bench') && called.includes('ci-release') && called.includes('bootstrap'), called.join(' '));
  assert.deepEqual([...new Set(called)].filter((target) => !defined.has(target)), [], 'a workflow runs a target that the Makefile does not define');
  for (const workflow of workflows()) assert.deepEqual(jobs(workflow.text).filter(calls).map((job) => job.name), [], `${workflow.name} calls another workflow`);
});

