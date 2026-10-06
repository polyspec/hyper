#!/usr/bin/env node
// The guard of the full suite. `make check` and `make rerun-failed` start it before any step:
//
//   node scripts/full-run.mjs run <target>...   run every target of the full suite
//   node scripts/full-run.mjs rerun-failed      rerun the targets of the current tree that did not pass
//
// The full suite runs once, when every active checklist item is done (AGENTS). The guard refuses a run while a task
// row of docs/plans/execution-checklist.md is `[~]`, while tracked changes are uncommitted, while the pre-push hook is
// not installed (scripts/git-hooks.mjs), and while the run of another process is still going on: a run holds the lock
// var/full-run.lock (scripts/holder-lock.mjs), so two runs that start together cannot both run. A full run is refused
// when var/full-run.json already records a run of the current tree (`git rev-parse HEAD^{tree}`); `rerun-failed` is
// refused unless that record exists and has targets that did not pass. The guard prints its decision with the reason,
// runs each target with `make <target>` to its end, prints its start and its result with the elapsed time, and writes
// the record before and after each target, so a run that is stopped stays recorded as `incomplete`. No step has a time
// limit.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { hooksProblem } from './git-hooks.mjs';
import { acquire } from './holder-lock.mjs';
import { versions } from './toolchain.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'Usage: node scripts/full-run.mjs run <target>... | rerun-failed';
export const CHECKLIST = 'docs/plans/execution-checklist.md';
// The record of the last full run of this checkout; /var/ is ignored by Git.
export const RECORD = 'var/full-run.json';
// The lock that a running full run holds (scripts/holder-lock.mjs): a second run of the checkout fails with its holder
// instead of deciding on a record that the first run is still writing (HY-82).
export const LOCK = 'var/full-run.lock';

const TASK_ROW = /^\|\s*(H\d[\w.-]*)\s*\|/;

/** The task rows of a checklist in state `[~]`, with the text of their task cell as title. */
export function activeItems(text) {
  const items = [];
  for (const line of text.split('\n')) {
    const row = TASK_ROW.exec(line);
    if (!row) continue;
    // A cell may contain an escaped `\|`.
    const cells = line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(cell => cell.trim());
    if (cells[cells.length - 1] === '[~]') items.push({ id: row[1], title: cells[1] });
  }
  return items;
}

const notPassed = record => record.targets.filter(target => target.status !== 'passed').map(target => target.name);

/**
 * Decides whether the guard runs. `mode` is `run` or `rerun-failed`; `active` the active checklist items; `dirty` the
 * `git status --porcelain` lines of tracked files; `hooks` why the pre-push hook is not installed, or null; `tree` the
 * current tree; `record` the record of the last run or null; `running` whether the process of an incomplete record
 * still exists. Returns `{ run, reason, targets }`.
 */
export function decide({ mode, targets, active, dirty, hooks, tree, record, running }) {
  const refuse = reason => ({ run: false, reason, targets: [] });
  if (active.length > 0) {
    return refuse(`${active.length} active checklist item${active.length === 1 ? '' : 's'} in ${CHECKLIST}; the full suite runs once, when every active item is done:\n${active.map(item => `  ${item.id} ${item.title}`).join('\n')}`);
  }
  if (dirty.length > 0) {
    return refuse(`the working tree has uncommitted tracked changes; a full run verifies a committed tree:\n${dirty.map(line => `  ${line}`).join('\n')}`);
  }
  if (hooks) return refuse(hooks);
  if (record && running) {
    return refuse(`the run started ${record.started} by process ${record.pid} is still running on tree ${record.tree}`);
  }
  if (mode === 'run') {
    if (record && record.tree === tree) {
      const open = notPassed(record);
      const rerun = open.length > 0 ? `; make rerun-failed reruns its targets that did not pass: ${open.join(', ')}` : '';
      return refuse(`the full run of tree ${tree} started ${record.started} with result ${record.result}; the full suite runs once per tree${rerun}`);
    }
    const before = record
      ? `tree ${tree} differs from the tree ${record.tree} of the last full run (result ${record.result}, started ${record.started})`
      : `no full-run record in ${RECORD} for tree ${tree}`;
    return { run: true, reason: `${before}; no active checklist item; ${targets.length} targets`, targets };
  }
  if (!record) return refuse(`no full-run record in ${RECORD}; rerun-failed reruns the targets of a full run of the current tree that did not pass`);
  if (record.tree !== tree) return refuse(`the last full run (started ${record.started}) verified tree ${record.tree}, not the current tree ${tree}; rerun-failed reruns only targets of the current tree`);
  const open = notPassed(record);
  if (open.length === 0) return refuse(`the full run of tree ${tree} started ${record.started} passed; no target failed`);
  return { run: true, reason: `the full run of tree ${tree} started ${record.started} has ${open.length} target${open.length === 1 ? '' : 's'} that did not pass: ${open.join(', ')}`, targets: open };
}

function git(root, ...args) {
  const run = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${root}: ${run.stderr.trim()}`);
  return run.stdout;
}

function readRecord(root) {
  const file = path.join(root, RECORD);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

function writeRecord(root, record) {
  const file = path.join(root, RECORD);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.${process.pid}`, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(`${file}.${process.pid}`, file);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    // EPERM: the process exists and belongs to another user.
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

const seconds = milliseconds => `${(milliseconds / 1000).toFixed(1)} s`;

// The number of last output lines of a failed target that the record and the summary keep (HY-84).
export const LAST_LINES = 20;

// Runs `make <target>` in the checkout and prints its output as it comes; resolves { passed, lastLines }, the last
// LAST_LINES lines of its standard output and standard error in the order of arrival.
export function makeTarget(root, target) {
  return new Promise((resolve, reject) => {
    const child = spawn('make', [target], { cwd: root, stdio: ['inherit', 'pipe', 'pipe'] });
    const lines = [];
    // Each stream that make leaves without a final newline gets one, so the next line of the guard starts at column 0.
    const keep = (stream, output) => {
      let pending = '';
      let last = '\n';
      stream.on('data', data => {
        output.write(data);
        if (data.length > 0) last = String(data).at(-1);
        pending += data;
        const parts = pending.split('\n');
        pending = parts.pop();
        lines.push(...parts);
        lines.splice(0, Math.max(0, lines.length - LAST_LINES));
      });
      return () => {
        if (pending !== '') lines.push(pending);
        if (last !== '\n') output.write('\n');
      };
    };
    const flushOut = keep(child.stdout, process.stdout);
    const flushErr = keep(child.stderr, process.stderr);
    child.once('error', reject);
    child.once('close', status => {
      flushOut();
      flushErr();
      resolve({ passed: status === 0, lastLines: lines.slice(-LAST_LINES) });
    });
  });
}

/**
 * Inspects the checkout, decides and runs. `runTarget(name)` resolves { passed, lastLines } of a target. Returns the exit
 * status: 0 when the full result of the tree is passed, 1 otherwise.
 */
export async function fullRun({ root = ROOT, mode, targets = [], runTarget = name => makeTarget(root, name), print = line => console.log(line) }) {
  const active = activeItems(readFileSync(path.join(root, CHECKLIST), 'utf8'));
  const dirty = git(root, 'status', '--porcelain', '--untracked-files=no').split('\n').filter(Boolean);
  const hooks = hooksProblem(root);
  const tree = git(root, 'rev-parse', 'HEAD^{tree}').trim();
  const record = readRecord(root);
  const running = Boolean(record && record.result === 'incomplete' && record.pid !== process.pid && alive(record.pid));
  const decision = decide({ mode, targets, active, dirty, hooks, tree, record, running });
  let release = () => {};
  if (decision.run) {
    try {
      release = acquire(path.join(root, LOCK), root);
    } catch (error) {
      print(`[full-run] refuse: another full run of this checkout: ${error.message}`);
      return 1;
    }
  }
  print(`[full-run] ${decision.run ? 'run' : 'refuse'}: ${decision.reason}`);
  if (!decision.run) return 1;
  try {
    return await runTargets({ root, mode, targets, runTarget, print, decision, record, tree });
  } finally {
    release();
  }
}

async function runTargets({ root, mode, targets, runTarget, print, decision, record, tree }) {
  const now = () => new Date().toISOString();
  const current = mode === 'run'
    ? { tree, environment: versions(), result: 'incomplete', pid: process.pid, started: now(), ended: null, targets: targets.map(name => ({ name, status: 'pending' })), reruns: [] }
    : { ...record, result: 'incomplete', pid: process.pid };
  const rerun = mode === 'run' ? null : { started: now(), ended: null, targets: decision.targets, result: 'incomplete' };
  if (rerun) current.reruns.push(rerun);
  writeRecord(root, current);

  const begin = Date.now();
  for (const [index, name] of decision.targets.entries()) {
    const target = current.targets.find(entry => entry.name === name);
    Object.assign(target, { status: 'running', started: now(), ended: null, elapsedMs: null });
    writeRecord(root, current);
    print(`[full-run] start ${name} (${index + 1}/${decision.targets.length})`);
    const targetBegin = Date.now();
    const { passed, lastLines } = await runTarget(name);
    Object.assign(target, { status: passed ? 'passed' : 'failed', ended: now(), elapsedMs: Date.now() - targetBegin });
    if (passed) delete target.lastLines;
    else target.lastLines = lastLines;
    writeRecord(root, current);
    print(`[full-run] ${name} ${target.status} in ${seconds(target.elapsedMs)}`);
  }

  const failed = current.targets.filter(target => target.status === 'failed').map(target => target.name);
  current.result = failed.length === 0 ? 'passed' : 'failed';
  current.failed = failed;
  current.ended = now();
  if (rerun) Object.assign(rerun, { ended: current.ended, result: decision.targets.every(name => !failed.includes(name)) ? 'passed' : 'failed' });
  writeRecord(root, current);
  const summary = `${decision.targets.length - decision.targets.filter(name => failed.includes(name)).length} of ${decision.targets.length} targets passed in ${seconds(Date.now() - begin)}`;
  // Each failed target is summarized with its last output lines, so the cause stands with the result (HY-84).
  for (const target of current.targets.filter(entry => entry.status === 'failed')) {
    print(`[full-run] ${target.name} failed; its last ${target.lastLines.length} lines:\n${target.lastLines.map(line => `  | ${line}`).join('\n')}`);
  }
  print(failed.length === 0
    ? `[full-run] result passed for tree ${tree}: ${summary}`
    : `[full-run] result failed for tree ${tree}: ${summary}; failed: ${failed.join(', ')}; make rerun-failed reruns them`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, ...targets] = process.argv.slice(2);
  if (!((mode === 'run' && targets.length > 0) || (mode === 'rerun-failed' && targets.length === 0))) {
    console.error(USAGE);
    process.exit(2);
  }
  process.exitCode = await fullRun({ mode, targets });
}
