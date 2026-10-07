#!/usr/bin/env node
// The runner of the CI groups of the full suite (HY-91). Each job of .github/workflows/ci.yml runs one group of the
// targets of CHECK_TARGETS, which the Makefile names in CI_TARGETS_<group>, through make:
//
//   node scripts/ci-run.mjs pins                     make ci-pins: the PHP minor of config/toolchain.json, as a
//                                                    step output
//   node scripts/ci-run.mjs run <group> <target>...  make ci-check GROUP=<group>: every target of the group
//   node scripts/ci-run.mjs summary <group>          make ci-summary GROUP=<group>: the summary of the run
//   node scripts/ci-run.mjs passed                   make ci-passed: every job of RESULTS passed
//
// `run` starts each target with its own `make --no-print-directory -k <target>` and lets it run to its end, also after
// an earlier target failed, with no time limit: a target is a long operation, which its log shows line by line. The
// report of the group is var/ci/<group>/: `record.json` with the tree, the running
// releases of the tools (the PHP patch among them) and each target with its status, its times and, for a failed
// target, its first failure lines; `logs/<target>.log` with the full output of each target; and `summary.md`. The
// record is written before and after each target, so a runner that stops leaves the target that was running. No report
// write throws: a failed write is printed and recorded in `reportErrors`, every target still runs, and the run fails.
// `run` refuses outside GitHub Actions, because the full suite of a checkout runs through the guard of `make check`
// once per tree (AGENTS).
//
// `summary` writes summary.md and the job summary of GitHub (GITHUB_STEP_SUMMARY) from the record, also when the run
// recorded nothing or did not record its end, and names every setup step that did not succeed from CI_STEPS, the
// JSON of the step results that the workflow passes (`toJSON(steps)`).
//
// `passed` is the step of the job ci-passed, the last job of ci.yml, which runs after every other job of the workflow
// (`if: ${{ always() }}`) and is the check of ci.yml that the ruleset main requires (HY-94). It reads the environment
// variable RESULTS, the JSON of `needs` (`{"<job>": {"result": "success", "outputs": {}}}`), prints the result of each
// job and fails unless every job has the result `success`: a failed, skipped or cancelled job fails it, and so do
// RESULTS that is unset, is not JSON or names no job.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { versions } from './toolchain.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'Usage: node scripts/ci-run.mjs pins | run <group> <target>... | summary <group> | passed';
// The number of failure lines and of last lines that the record keeps of a failed target.
export const FAILURE_LINES = 20;
// The variables of a calling make, which a target of the run does not inherit.
const CALLER = ['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL', 'MAKEOVERRIDES'];

export const reportDirectory = (root, group) => path.join(root, 'var', 'ci', group);

// A line that states a failure: a failed test, an error, a failed check of a recipe, a panic or a full disk. A line
// that reports a pass, such as `✔ ... 0 failed`, is not one. The lines in which make names a failed recipe are left
// to the last lines, because the exit line of the target states the same.
const FAILURE = [
  /^(?:FAIL|TIMEOUT)\b/, /^not ok\b/, /✖/, /panicked at|^panic:/,
  /(?<![-/.\w])(?:error|Error|ERROR)\b/,
  /\b[1-9]\d* failed\b|failed checks:|\bfailed:|exited with (?:code |status )?[1-9]/,
  /No space left on device|ENOSPC|EDQUOT/,
];
// A warning of a passing target, such as a size above its limit (scripts/check-bundle-size.mjs): measured, never a
// failure, and named in the summary.
const WARNING = /^WARNING /;
const MAKE_LINE = /^make(?:\[\d+\])?: (?:\*\*\*|Target .* not remade)/;
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

// A line in which a test reporter of this repository (scripts/test-progress, PHPUnit through scripts/run-tests.mjs)
// marks a failure, and a line in which it starts a test, whose name may hold an error word.
const MARKED = /✖/;
const START = /^(?:\[\s*[\d.]+s\] )?▶ /;

/**
 * The first failure lines of a failed target, then `exit`, how make ended. When a reporter marked failures with `✖`,
 * they are the marked lines with the indented detail lines that follow each, because other lines that hold an error
 * word, such as the output of a passing test that starts a failing server, are not the failure. Otherwise they are the
 * failure lines in their order, never a start line `▶`, else the last lines. At most FAILURE_LINES lines.
 */
export function failureLines(lines, exit) {
  const plain = lines.map((line) => line.replace(ANSI, ''));
  const marked = [];
  let detail = false;
  for (const line of plain) {
    if (MARKED.test(line)) {
      marked.push(line);
      detail = true;
    } else if (detail && /^\s+\S/.test(line)) marked.push(line);
    else detail = false;
  }
  if (marked.length > 0) return [...marked.slice(0, FAILURE_LINES), exit];
  const failed = plain.filter((line) => !line.includes('✔') && !START.test(line) && !MAKE_LINE.test(line) && FAILURE.some((pattern) => pattern.test(line)));
  return [...(failed.length > 0 ? failed.slice(0, FAILURE_LINES) : plain.filter((line) => line.trim() !== '').slice(-FAILURE_LINES)), exit];
}

/** A writer of report files that never throws: a failed write is printed and kept in `errors`. */
function reportWriter(print) {
  const errors = [];
  const attempt = (file, action) => {
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      action();
    } catch (error) {
      const message = `report write failed: ${file}: ${error.code ?? error.message}`;
      errors.push(message);
      print(`[ci] ${message}`);
    }
  };
  return {
    errors,
    write: (file, text) => attempt(file, () => {
      writeFileSync(`${file}.${process.pid}`, text);
      renameSync(`${file}.${process.pid}`, file);
    }),
    append: (file, text) => attempt(file, () => appendFileSync(file, text)),
  };
}

function git(root, ...args) {
  const run = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return run.status === 0 ? run.stdout.trim() : `unknown (git ${args.join(' ')}: ${(run.stderr || run.error?.message || '').trim()})`;
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { error: `${file}: ${error.code ?? error.message}` };
  }
}

/** The pin that the workflow reads before it sets up PHP. */
export function pins({ root = ROOT, env = process.env, print = (line) => console.log(line) } = {}) {
  const php = JSON.parse(readFileSync(path.join(root, 'config/toolchain.json'), 'utf8')).php;
  if (!/^\d+\.\d+$/.test(php ?? '')) throw new Error(`config/toolchain.json pins no PHP minor: expected "php" as <major>.<minor>, actual ${JSON.stringify(php)}`);
  const text = `php=${php}\n`;
  print(text.trimEnd());
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, text);
  return { php };
}

// Runs `make <target>` in the checkout: its output goes to `output` and into the log of the target line by line, as
// the lines come. A line is passed on when it is complete, so the output of standard output and standard error never
// joins on one line, also where a tool ends its output without a final newline (HY-84). Resolves the lines of the
// output and how make ended.
function makeTarget({ root, target, env, log, writer, output }) {
  return new Promise((resolve) => {
    const clean = Object.fromEntries(Object.entries({ ...process.env, ...env }).filter(([name]) => !CALLER.includes(name)));
    const command = ['--no-print-directory', '-k', target];
    writer.write(log, `make ${command.join(' ')}\n`);
    const child = spawn('make', command, { cwd: root, env: clean, stdio: ['ignore', 'pipe', 'pipe'] });
    const lines = [];
    const pending = { stdout: '', stderr: '' };
    const pass = (name, complete) => {
      if (complete.length === 0) return;
      const text = `${complete.join('\n')}\n`;
      output(text, name);
      writer.append(log, text);
      lines.push(...complete);
    };
    const take = (name) => (data) => {
      const parts = `${pending[name]}${data}`.split('\n');
      pending[name] = parts.pop();
      pass(name, parts);
    };
    child.stdout.on('data', take('stdout'));
    child.stderr.on('data', take('stderr'));
    let ended = false;
    const finish = (exit) => {
      if (ended) return;
      ended = true;
      for (const name of ['stdout', 'stderr']) {
        if (pending[name] !== '') pass(name, [pending[name]]);
        pending[name] = '';
      }
      writer.append(log, `${exit}\n`);
      resolve({ lines, exit });
    };
    child.once('error', (error) => finish(`make ${target} could not start: ${error.message}`));
    child.once('close', (status, signal) => finish(signal ? `make ${target} ended on ${signal}` : `make ${target} exited with status ${status}`));
  });
}

const seconds = (milliseconds) => (Number.isFinite(milliseconds) ? `${(milliseconds / 1000).toFixed(1)} s` : '-');
const cell = (text) => text.replaceAll('|', '\\|').replaceAll('\n', ' ');

/** The summary of a record, or of a run that recorded nothing; `steps` are the results of the setup steps. */
export function render({ group, record, steps = {} }) {
  const lines = [`# CI ${group}`, ''];
  const setup = Object.entries(steps).filter(([, step]) => step && typeof step === 'object');
  const failedSetup = setup.filter(([, step]) => step.outcome !== 'success' && step.outcome !== 'skipped');
  if (!record || record.error) {
    lines.push(`**make ci-check GROUP=${group} recorded no run**${record?.error ? ` (${record.error})` : ''}: it stopped before its first target, or the step did not run. The log of that step shows why.`, '');
  } else {
    const environment = Object.entries(record.environment ?? {}).map(([tool, version]) => `${tool} ${version}`).join(', ');
    lines.push(`tree \`${record.tree}\`, started ${record.started}, ended ${record.ended ?? 'never'}, result **${record.result}**`, '');
    if (environment) lines.push(`environment: ${environment}`, '');
    const running = record.targets.find((target) => target.status === 'running');
    if (record.result === 'incomplete') lines.push(`**The runner ended without recording the end of its run; ${running ? `${running.name} was running` : 'no target was running'}.** The targets below are as the runner last recorded them.`, '');
  }
  if (setup.length > 0) {
    lines.push('| setup step | outcome |', '|---|---|', ...setup.map(([id, step]) => `| ${cell(id)} | ${cell(String(step.outcome))} |`), '');
    for (const [id] of failedSetup) lines.push(`- the setup step ${id} failed; its output is in the job log of that step`);
    if (failedSetup.length > 0) lines.push('');
  }
  if (record && !record.error) {
    const count = (...statuses) => record.targets.filter((target) => statuses.includes(target.status)).length;
    const warned = record.targets.flatMap((target) => (target.warnings ?? []).map((warning) => `- ${target.name}: ${warning}`));
    lines.push(`${count('passed')} passed, ${count('failed')} failed, ${count('running', 'pending')} not finished${warned.length > 0 ? `, ${warned.length} warning${warned.length === 1 ? '' : 's'}` : ''}.`, '');
    lines.push('| target | status | time | first failure lines |', '|---|---|---|---|');
    for (const target of record.targets) {
      lines.push(`| ${cell(target.name)} | ${target.status} | ${seconds(target.elapsedMs)} | ${cell((target.failures ?? []).slice(0, 3).join(' / '))} |`);
    }
    if (warned.length > 0) lines.push('', '## warnings', '', ...warned);
    const errors = record.reportErrors ?? [];
    if (errors.length > 0) lines.push('', '## report write failures', '', '```', ...errors, '```');
    for (const target of record.targets.filter((entry) => entry.status === 'failed')) {
      lines.push('', `## ${target.name}`, '', `log: \`${target.log}\``, '', '```', ...(target.failures ?? []), '```');
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Runs the targets of a CI group and writes its report. `output(text, stream)` receives the output of the targets,
 * `print` the lines of the runner and `fail` a refusal.
 * Returns the exit status: 0 when every target passed and every report write succeeded, 1 otherwise, 2 for a refusal.
 */
export async function ciRun({ root = ROOT, group, targets, env = process.env, print = (line) => console.log(line), fail = (line) => console.error(line), output = (text, stream) => process[stream].write(text) }) {
  if (env.GITHUB_ACTIONS !== 'true') {
    fail('[ci] refuse: scripts/ci-run.mjs runs only on GitHub Actions (GITHUB_ACTIONS=true); make check runs the full suite once per tree');
    return 2;
  }
  if (!/^[\w-]+$/.test(group ?? '') || targets.length === 0) {
    fail(`[ci] refuse: CI group ${group} has no targets; the Makefile names them in CI_TARGETS_${group}`);
    return 2;
  }
  const report = reportDirectory(root, group);
  const writer = reportWriter(print);
  const now = () => new Date().toISOString();
  const record = {
    group,
    tree: git(root, 'rev-parse', 'HEAD^{tree}'),
    environment: { ...versions(), runner: `${env.ImageOS ?? 'unknown image'} ${env.ImageVersion ?? ''}`.trim() },
    result: 'incomplete',
    started: now(),
    ended: null,
    targets: targets.map((name) => ({ name, status: 'pending', log: `logs/${name}.log` })),
  };
  const save = () => {
    record.reportErrors = [...writer.errors];
    writer.write(path.join(report, 'record.json'), `${JSON.stringify(record, null, 2)}\n`);
  };
  save();
  print(`[ci] group ${group}: ${targets.length} targets on tree ${record.tree}`);
  for (const [index, target] of record.targets.entries()) {
    Object.assign(target, { status: 'running', started: now() });
    save();
    print(`[ci] start ${target.name} (${index + 1}/${targets.length})`);
    const begin = Date.now();
    const { lines, exit } = await makeTarget({ root, target: target.name, env, log: path.join(report, target.log), writer, output });
    const passed = exit === `make ${target.name} exited with status 0`;
    Object.assign(target, { status: passed ? 'passed' : 'failed', ended: now(), elapsedMs: Date.now() - begin });
    if (!passed) target.failures = failureLines(lines, exit);
    const warnings = lines.map((line) => line.replace(ANSI, '')).filter((line) => WARNING.test(line));
    if (warnings.length > 0) target.warnings = warnings.slice(0, FAILURE_LINES);
    save();
    print(`[ci] ${target.name} ${target.status} in ${seconds(target.elapsedMs)}`);
  }
  const failed = record.targets.filter((target) => target.status === 'failed');
  record.result = failed.length === 0 ? 'passed' : 'failed';
  record.ended = now();
  save();
  // The record of the end is written once more after the summary, so a failed write of the summary is recorded too.
  writer.write(path.join(report, 'summary.md'), render({ group, record }));
  save();
  for (const target of failed) print(`[ci] ${target.name} failed; its first failure lines:\n${target.failures.map((line) => `  | ${line}`).join('\n')}`);
  if (writer.errors.length > 0) print(`[ci] ${writer.errors.length} report write(s) failed:\n${writer.errors.join('\n')}`);
  print(`[ci] result ${record.result}: ${targets.length - failed.length} of ${targets.length} targets passed; report ${path.relative(root, report)}`);
  return failed.length === 0 && writer.errors.length === 0 ? 0 : 1;
}

/** Writes summary.md and the job summary of the group. Returns 0, or 1 when a write failed. */
export function ciSummary({ root = ROOT, group, env = process.env, print = (line) => console.log(line) }) {
  const report = reportDirectory(root, group);
  const file = path.join(report, 'record.json');
  const record = existsSync(file) ? readJson(file) : null;
  let steps = {};
  if (env.CI_STEPS) {
    try {
      steps = JSON.parse(env.CI_STEPS);
    } catch (error) {
      print(`[ci] CI_STEPS is not JSON: ${error.message}`);
    }
  }
  const text = render({ group, record, steps });
  const writer = reportWriter(print);
  writer.write(path.join(report, 'summary.md'), text);
  if (env.GITHUB_STEP_SUMMARY) writer.append(env.GITHUB_STEP_SUMMARY, text);
  print(text.trimEnd());
  return writer.errors.length === 0 ? 0 : 1;
}

/** make ci-passed: 0 when every job of `text`, the JSON of `needs`, has the result success, else 1. */
export function ciPassed({ text, print = console.log }) {
  const fail = (message) => {
    print(`[ci-passed] failed: ${message}`);
    return 1;
  };
  if (text === undefined) return fail('RESULTS is not set; the step passes the JSON of needs: make ci-passed RESULTS=<json>');
  let needs;
  try {
    needs = JSON.parse(text);
  } catch (error) {
    return fail(`RESULTS is not JSON: ${error.message}: ${JSON.stringify(text)}`);
  }
  if (needs === null || typeof needs !== 'object' || Array.isArray(needs) || Object.keys(needs).length === 0) return fail(`RESULTS names no job: ${JSON.stringify(text)}`);
  const failed = [];
  for (const [job, value] of Object.entries(needs)) {
    const result = value !== null && typeof value === 'object' && typeof value.result === 'string' ? value.result : 'no result';
    print(`[ci-passed] ${job}: ${result}`);
    if (result !== 'success') failed.push(`${job} (${result})`);
  }
  if (failed.length > 0) return fail(`${failed.join(', ')}; every needed job must have the result success`);
  print(`[ci-passed] every needed job passed: ${Object.keys(needs).join(', ')}`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, group, ...targets] = process.argv.slice(2);
  try {
    if (mode === 'pins' && group === undefined) pins();
    else if (mode === 'run' && group) process.exitCode = await ciRun({ group, targets });
    else if (mode === 'summary' && group && targets.length === 0) process.exitCode = ciSummary({ group });
    else if (mode === 'passed' && group === undefined) process.exitCode = ciPassed({ text: process.env.RESULTS });
    else {
      console.error(USAGE);
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(`[ci] ${error.stack ?? error.message}`);
    process.exitCode = 1;
  }
}
