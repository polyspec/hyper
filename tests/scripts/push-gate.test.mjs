// Tests the push gate (scripts/push-gate.mjs): the pre-push hook .githooks/pre-push refuses a push while a task of the
// checklist is [~] in a pushed commit or in the working tree, and when a pushed commit has no checklist; every make run
// installs the hook; `hooks-check` fails while the hook is not installed; the workflow push-gate runs `commit <sha>`,
// which fails for a task in progress and for a commit that does not track the hook as executable, and `make docs-check`,
// which fails for a checklist that breaks the document rules (H13.2). Each test pushes to a temporary bare repository.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { dryRun } from './make-dry-run.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHECKLIST = 'docs/plans/execution-checklist.md';
// The files that the hook runs, copied from this checkout into each temporary checkout.
// The scripts that the gate imports, followed through their relative imports, so that the copy of the checkout runs
// the gate whatever modules it comes to import.
function imports(file, found = new Set()) {
  if (found.has(file)) return found;
  found.add(file);
  for (const [, target] of readFileSync(path.join(ROOT, file), 'utf8').matchAll(/^import [^;]* from '(\.\.?\/[^']+)';$/gm)) {
    imports(path.join(path.dirname(file), target), found);
  }
  return found;
}

const FILES = ['.githooks/pre-push', 'Makefile', ...imports('scripts/push-gate.mjs'), ...imports('scripts/check-documents.mjs')];

const ACTIVE = `| ID | Task | Verification | Status |
|---|---|---|---|
| H1.1 | Write the parser | \`make test-ts\` | [o] |
| H1.2 | Print a union | \`make test-ts\` | [~] |
`;
const DONE = ACTIVE.replace('| [~] |', '| [o] |');

function run(cwd, command, args, options = {}) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', ...options });
}

function git(cwd, ...args) {
  const result = run(cwd, 'git', args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

const commitAll = (directory, message) => {
  git(directory, 'add', '--all');
  git(directory, '-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', message);
  return git(directory, 'rev-parse', 'HEAD');
};

// A Git checkout with the hook, the gate, the Makefile and a committed checklist, and an empty bare remote. The hook is
// installed unless `install` is false.
function checkout(t, checklist, install = true) {
  const base = mkdtempSync(path.join(tmpdir(), 'hyper-push-gate-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const directory = path.join(base, 'checkout');
  const remote = path.join(base, 'remote.git');
  for (const file of FILES) {
    mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    copyFileSync(path.join(ROOT, file), path.join(directory, file));
  }
  chmodSync(path.join(directory, '.githooks/pre-push'), 0o755);
  mkdirSync(path.join(directory, 'docs/plans'), { recursive: true });
  writeFileSync(path.join(directory, CHECKLIST), checklist);
  git(directory, 'init', '--quiet', '--initial-branch=main');
  git(base, 'init', '--quiet', '--bare', remote);
  if (install) git(directory, 'config', 'core.hooksPath', '.githooks');
  commitAll(directory, 'checklist');
  return { directory, remote };
}

const push = (directory, remote) => run(directory, 'git', ['push', remote, 'HEAD:refs/heads/main']);
const remoteMain = remote => run(remote, 'git', ['rev-parse', '--verify', '--quiet', 'refs/heads/main']).stdout.trim();
const hooksPath = directory => run(directory, 'git', ['config', 'core.hooksPath']).stdout.trim();

test('the hook allows a push without a task in progress and refuses a pushed commit with one', t => {
  const { directory, remote } = checkout(t, DONE);
  const allowed = push(directory, remote);
  assert.equal(allowed.status, 0, allowed.stderr);
  const pushed = git(directory, 'rev-parse', 'HEAD');
  assert.equal(remoteMain(remote), pushed);

  writeFileSync(path.join(directory, CHECKLIST), ACTIVE);
  const active = commitAll(directory, 'start H1.2');
  const refused = push(directory, remote);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /push refused: checklist tasks are in progress \(docs\/plans\/execution-checklist\.md\)/);
  assert.match(refused.stderr, new RegExp(`refs/heads/main ${active.slice(0, 7)}: H1\\.2 Print a union`));
  assert.match(refused.stderr, /working tree: H1\.2 Print a union/);
  assert.match(refused.stderr, /A push happens only when no checklist task is \[~\] \(AGENTS\.md\)/);
  assert.match(refused.stderr, /Complete each task/);
  assert.doesNotMatch(refused.stderr, /no-verify/);
  assert.equal(remoteMain(remote), pushed);
});

test('the hook refuses a push while the working tree has a task in progress', t => {
  const { directory, remote } = checkout(t, DONE);
  writeFileSync(path.join(directory, CHECKLIST), ACTIVE);
  const refused = push(directory, remote);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /working tree: H1\.2 Print a union/);
  assert.doesNotMatch(refused.stderr, /refs\/heads\/main [0-9a-f]{7}: H1\.2/);
  assert.equal(remoteMain(remote), '');
});

test('the hook refuses a pushed commit without the checklist', t => {
  const { directory, remote } = checkout(t, DONE);
  git(directory, 'rm', '--quiet', CHECKLIST);
  const missing = commitAll(directory, 'remove the checklist');
  // The working tree has the checklist again, so only the pushed commit lacks it.
  mkdirSync(path.join(directory, 'docs/plans'), { recursive: true });
  writeFileSync(path.join(directory, CHECKLIST), DONE);
  const refused = push(directory, remote);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /push refused: the push gate cannot verify the pushed tree/);
  assert.match(refused.stderr, new RegExp(`refs/heads/main ${missing.slice(0, 7)}: .*docs/plans/execution-checklist\\.md`));
  assert.equal(remoteMain(remote), '');
});

test('hooks-check fails until make installs the hook, and every make run installs it', t => {
  const { directory } = checkout(t, DONE, false);
  const missing = run(directory, 'node', ['scripts/push-gate.mjs', 'hooks-check']);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /pre-push hook is not installed: core\.hooksPath is not set, not \.githooks; run make hooks/);

  const hooks = run(directory, 'make', ['hooks']);
  assert.equal(hooks.status, 0, hooks.stdout + hooks.stderr);
  assert.equal(hooksPath(directory), '.githooks');

  git(directory, 'config', '--unset', 'core.hooksPath');
  const help = run(directory, 'make', ['help']);
  assert.equal(help.status, 0, help.stderr);
  assert.equal(hooksPath(directory), '.githooks');

  chmodSync(path.join(directory, '.githooks/pre-push'), 0o644);
  const plain = run(directory, 'node', ['scripts/push-gate.mjs', 'hooks-check']);
  assert.equal(plain.status, 1);
  assert.match(plain.stderr, /\.githooks\/pre-push is not executable/);
});

test('the workflow command fails for a task in progress and for an untracked or non-executable hook', t => {
  const { directory } = checkout(t, DONE);
  const summary = path.join(directory, '..', 'summary.md');
  const gate = sha => run(directory, 'node', ['scripts/push-gate.mjs', 'commit', sha], { env: { ...process.env, GITHUB_STEP_SUMMARY: summary } });

  const clean = gate(git(directory, 'rev-parse', 'HEAD'));
  assert.equal(clean.status, 0, clean.stderr);

  writeFileSync(path.join(directory, CHECKLIST), ACTIVE);
  const active = commitAll(directory, 'start H1.2');
  const refused = gate(active);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, new RegExp(`^::error::push gate failed: checklist tasks are in progress`, 'm'));
  assert.match(refused.stdout, new RegExp(`^::error::  commit ${active.slice(0, 7)}: H1\\.2 Print a union$`, 'm'));
  assert.match(readFileSync(summary, 'utf8'), /H1\.2 Print a union/);

  writeFileSync(path.join(directory, CHECKLIST), DONE);
  chmodSync(path.join(directory, '.githooks/pre-push'), 0o644);
  const plain = commitAll(directory, 'hook without its mode');
  const notExecutable = gate(plain);
  assert.equal(notExecutable.status, 1);
  assert.match(notExecutable.stdout, /::error::  commit [0-9a-f]{7}: \.githooks\/pre-push is tracked with mode 100644, not 100755/);

  git(directory, 'rm', '--quiet', '.githooks/pre-push');
  const untracked = gate(commitAll(directory, 'no hook'));
  assert.equal(untracked.status, 1);
  assert.match(untracked.stdout, /::error::  commit [0-9a-f]{7}: the commit does not track \.githooks\/pre-push/);
});

// The make commands of the steps of the job push-gate, with the commit of the run in place of its expression.
function pushGateCommands(sha) {
  const workflow = readFileSync(path.join(ROOT, '.github/workflows/push-gate.yml'), 'utf8');
  return [...workflow.matchAll(/^ {6}- run: (make .*)$/gm)].map(match => match[1].replace('${{ github.event.pull_request.head.sha || github.sha }}', sha));
}

test('the job push-gate fails a commit whose checklist breaks the document rules (H13.2)', t => {
  // A marker outside a task state: make docs-check fails for it, and no task is [~], so the gate of tasks passes.
  const broken = `${DONE}| H1.3 | Write [x] the printer | \`make test-ts\` | [ ] |\n`;
  const { directory } = checkout(t, broken);
  writeFileSync(path.join(directory, CHECKLIST.replace(/\.md$/, '.ko.md')), broken);
  const sha = commitAll(directory, 'broken marker');
  const commands = pushGateCommands(sha);
  assert.ok(commands.length > 0, 'the job push-gate runs no make step');
  const results = commands.map(command => ({ command, ...run(directory, 'sh', ['-c', command]) }));
  const failed = results.filter(result => result.status !== 0);
  assert.ok(failed.length > 0, `every step of the job push-gate passed a broken checklist:\n${results.map(result => `${result.command}: ${result.status}`).join('\n')}`);
  assert.match(failed.map(result => result.stdout + result.stderr).join('\n'), /execution-checklist\.md:\d+:\d+/);

  // The same job passes the checklist without the broken marker.
  writeFileSync(path.join(directory, CHECKLIST), DONE);
  writeFileSync(path.join(directory, CHECKLIST.replace(/\.md$/, '.ko.md')), DONE);
  const clean = commitAll(directory, 'fixed marker');
  for (const command of pushGateCommands(clean)) {
    const result = run(directory, 'sh', ['-c', command]);
    assert.equal(result.status, 0, `${command}\n${result.stdout}${result.stderr}`);
  }
});

test('the workflow push-gate runs the gate on every push and pull request', () => {
  const workflow = readFileSync(path.join(ROOT, '.github/workflows/push-gate.yml'), 'utf8');
  assert.match(workflow, /^on:\n {2}push:\n {4}branches-ignore: \['gh-readonly-queue\/\*\*'\]\n {2}pull_request:\n {2}merge_group:\n/m);
  assert.doesNotMatch(workflow, /timeout-minutes/);
  assert.match(workflow, /^ {2}push-gate:\n/m);
  assert.match(workflow, /node-version-file: \.node-version/);
  assert.match(workflow, /run: make push-gate-commit COMMIT=\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  assert.deepEqual(dryRun('push-gate-commit', { variables: ['COMMIT=0123abc'] }), ['node scripts/push-gate.mjs commit 0123abc']);
  const missing = spawnSync('make', ['--no-print-directory', '-n', 'push-gate-commit'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, MAKEFLAGS: '', MAKELEVEL: '' } });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /COMMIT names the commit that the push gate checks/);
});
