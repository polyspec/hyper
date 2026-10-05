#!/usr/bin/env node
// The push gate. A push happens only when no checklist task is [~] (AGENTS):
//
//   node scripts/push-gate.mjs hook           the pre-push hook .githooks/pre-push; stdin holds the refs of the push
//   node scripts/push-gate.mjs commit <rev>   the job push-gate of .github/workflows/push-gate.yml
//   node scripts/push-gate.mjs hooks-check    fail while the pre-push hook is not installed (make hooks-check)
//
// `hook` reads the checklist of every pushed commit and of the working tree, and refuses the push when one of them has
// a task in progress or cannot be read. `commit` reads the checklist of one commit and requires the commit to track the
// hook as an executable file; it prints each line of a failure as a GitHub annotation and appends the failure to the
// job summary. The tasks in progress are those of the guard of the full run (`activeItems` of scripts/full-run.mjs).
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { activeItems, CHECKLIST } from './full-run.mjs';
import { HOOKS_PATH, hooksProblem, PRE_PUSH } from './git-hooks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'Usage: node scripts/push-gate.mjs hook | commit <rev> | hooks-check';
const NO_COMMIT = /^0+$/;

function git(root, ...args) {
  const run = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (run.error) throw run.error;
  return run;
}

const firstLine = text => text.trim().split('\n')[0];

/**
 * Reads the checklist of `sha` into `found`: its tasks in progress under the place `where`, or the reason why it
 * cannot be read.
 */
function inspectCommit(root, where, sha, found) {
  const show = git(root, 'show', `${sha}:${CHECKLIST}`);
  if (show.status !== 0) {
    found.problems.push(`${where}: ${firstLine(show.stderr) || `git show exited with ${show.status}`}`);
    return;
  }
  inspectText(where, () => show.stdout, found);
}

function inspectText(where, read, found) {
  try {
    for (const item of activeItems(read())) found.items.push(`${where}: ${item.id} ${item.title}`);
  } catch (error) {
    found.problems.push(`${where}: ${error.message}`);
  }
}

/** The lines of a failure of the gate, or an empty list when nothing was found. */
export function report(heading, { items, problems }) {
  const lines = [];
  if (items.length > 0) lines.push(`${heading}: checklist tasks are in progress (${CHECKLIST})`, ...items.map(line => `  ${line}`));
  if (problems.length > 0) lines.push(`${heading}: the push gate cannot verify the pushed tree`, ...problems.map(line => `  ${line}`));
  if (lines.length === 0) return lines;
  lines.push('A push happens only when no checklist task is [~] (AGENTS.md): CI runs the full suite on the pushed tree, and its guard refuses a tree with a task in progress.');
  if (items.length > 0) lines.push('Complete each task ([o] with its changelog entry, committed), or mark it [!] with its cause and retry condition when it must be bypassed; then push again.');
  if (problems.length > 0) lines.push(`Push commits that track ${CHECKLIST} and ${PRE_PUSH} as an executable file; then push again.`);
  return lines;
}

/** The pre-push hook: `input` holds the lines `<local ref> <local sha> <remote ref> <remote sha>` of the push. */
export function hook(root, input) {
  const found = { items: [], problems: [] };
  for (const line of input.split('\n').filter(Boolean)) {
    const [, localSha, remoteRef] = line.split(' ');
    // A deleted ref pushes no commit.
    if (!localSha || NO_COMMIT.test(localSha)) continue;
    inspectCommit(root, `${remoteRef} ${localSha.slice(0, 7)}`, localSha, found);
  }
  inspectText('working tree', () => readFileSync(path.join(root, CHECKLIST), 'utf8'), found);
  return report('push refused', found);
}

/** The workflow push-gate: the checklist and the hook of the commit `rev`. */
export function commit(root, rev) {
  const found = { items: [], problems: [] };
  const resolved = git(root, 'rev-parse', '--verify', '--quiet', `${rev}^{commit}`);
  if (resolved.status !== 0) {
    found.problems.push(`${rev}: not a commit of this repository`);
    return report('push gate failed', found);
  }
  const sha = resolved.stdout.trim();
  const where = `commit ${sha.slice(0, 7)}`;
  inspectCommit(root, where, sha, found);
  const tree = git(root, 'ls-tree', sha, '--', PRE_PUSH);
  const mode = tree.status === 0 ? tree.stdout.split(' ')[0] : '';
  if (mode === '') found.problems.push(`${where}: the commit does not track ${PRE_PUSH}`);
  else if (mode !== '100755') found.problems.push(`${where}: ${PRE_PUSH} is tracked with mode ${mode}, not 100755`);
  return report('push gate failed', found);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'hook' && args.length === 0) {
    const lines = hook(ROOT, readFileSync(0, 'utf8'));
    if (lines.length > 0) process.stderr.write(`${lines.join('\n')}\n`);
    process.exitCode = lines.length > 0 ? 1 : 0;
  } else if (mode === 'commit' && args.length === 1) {
    const lines = commit(ROOT, args[0]);
    if (lines.length > 0) {
      process.stderr.write(`${lines.join('\n')}\n`);
      process.stdout.write(lines.map(line => `::error::${line}\n`).join(''));
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### push-gate\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`);
    } else {
      process.stdout.write(`push gate passed: commit ${args[0]} has no checklist task in progress and tracks ${PRE_PUSH} as an executable file\n`);
    }
    process.exitCode = lines.length > 0 ? 1 : 0;
  } else if (mode === 'hooks-check' && args.length === 0) {
    const problem = hooksProblem(ROOT);
    if (problem) process.stderr.write(`hooks-check: ${problem}\n`);
    else process.stdout.write(`hooks-check: the pre-push hook is installed (core.hooksPath ${HOOKS_PATH})\n`);
    process.exitCode = problem ? 1 : 0;
  } else {
    console.error(USAGE);
    process.exitCode = 2;
  }
}
