// Tests the guard of the full suite (scripts/full-run.mjs): `make check` starts the guard before any step, the guard
// refuses while a checklist item is `[~]`, while tracked changes are uncommitted, while the pre-push hook is not
// installed and when the current tree already has a full run, it records each target as the run proceeds, and `make rerun-failed` reruns only the targets of the
// current tree that did not pass. The targets of these tests are stubs; no test runs a real target.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { activeItems, decide, fullRun, LAST_LINES, makeTarget, RECORD } from '../../scripts/full-run.mjs';
import { dryRun } from './make-dry-run.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const CHECKLIST = `# Execution checklist

- The last column of every task row is its state: \`[ ]\` waiting, \`[~]\` in progress, \`[o]\` done.

| ID | Task | Verification | Done |
| --- | --- | --- | --- |
| H1.1 | Write the parser | \`make test-ts\` | [o] |
| H1.2 | Print \`a \\| b\` for a union | \`make test-ts\` | [~] |
| H1.2-1 | Name the union members | \`make test-ts\` | [ ] |
| H1.3 | Remove the old runner | \`make test-scripts\` | [!] cause: blocked; retry: H1.2 done |
`;

const DONE = CHECKLIST.replace('| [~] |', '| [o] |');

// The template repository of a fixture checkout: a Git repository in the ignored var/template whose tag v0.0.1 names
// its first commit.
const TEMPLATE = { repository: 'var/template', tag: 'v0.0.1' };


function git(cwd, ...args) {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
}

// A Git checkout with a committed checklist and an installed pre-push hook.
function checkout(t, checklist) {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-full-run-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(path.join(directory, 'docs/plans'), { recursive: true });
  writeFileSync(path.join(directory, 'docs/plans/execution-checklist.md'), checklist);
  writeFileSync(path.join(directory, '.gitignore'), '/var/\n');
  mkdirSync(path.join(directory, '.githooks'));
  writeFileSync(path.join(directory, '.githooks/pre-push'), '#!/bin/sh\n');
  chmodSync(path.join(directory, '.githooks/pre-push'), 0o755);
  git(directory, 'init', '--quiet');
  git(directory, 'config', 'core.hooksPath', '.githooks');
  git(directory, 'add', '.');
  git(directory, '-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', 'checklist');
  const template = path.join(directory, TEMPLATE.repository);
  mkdirSync(template, { recursive: true });
  git(template, 'init', '--quiet', '-b', 'main');
  tagTemplate(directory, commitTemplate(directory, 'first'));
  return directory;
}

// Commits to the branch main of the template repository of a fixture checkout and returns the new commit; the tag
// stays where it is.
function commitTemplate(directory, message) {
  const template = path.join(directory, TEMPLATE.repository);
  git(template, '-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '--allow-empty', '-m', message);
  return git(template, 'rev-parse', 'HEAD');
}
// Points the tag of the template repository of a fixture checkout at a commit.
const tagTemplate = (directory, commit) => git(path.join(directory, TEMPLATE.repository), 'tag', '--force', TEMPLATE.tag, commit);
const templateTag = directory => git(path.join(directory, TEMPLATE.repository), 'rev-parse', `refs/tags/${TEMPLATE.tag}^{commit}`);

const commit = (directory, file, text) => {
  writeFileSync(path.join(directory, file), text);
  git(directory, 'add', file);
  git(directory, '-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', file);
};

const record = directory => JSON.parse(readFileSync(path.join(directory, RECORD), 'utf8'));

// Runs the guard with stub targets that pass unless they are named in `failing`; returns the exit status, the
// printed lines and the targets that ran.
async function guard(directory, mode, targets, failing = []) {
  const lines = [];
  const ran = [];
  const status = await fullRun({
    root: directory,
    template: TEMPLATE,
    mode,
    targets,
    print: line => lines.push(line),
    runTarget: async name => {
      // The record names the target as running while it runs, with the run still incomplete.
      const current = record(directory);
      assert.equal(current.result, 'incomplete');
      assert.equal(current.targets.find(target => target.name === name).status, 'running');
      ran.push(name);
      return { passed: !failing.includes(name), lastLines: [`${name}: error 1`, `${name}: error 2`] };
    },
  });
  return { status, output: lines.join('\n'), ran };
}

test('make check and make rerun-failed start the guard before any step', () => {
  const check = dryRun('check');
  // The guard reads the commit of the template tag from the template repository of the Makefile (HY-80).
  assert.match(check[0], /^TEMPLATE_REPOSITORY=\.\.\/template TEMPLATE_TAG=v0\.0\.2 node scripts\/full-run\.mjs run template-check bench-server-smoke docs-check lint /, check.join('\n'));
  assert.equal(check.length, 1, check.join('\n'));
  const rerun = ['TEMPLATE_REPOSITORY=../template TEMPLATE_TAG=v0.0.2 node scripts/full-run.mjs rerun-failed'];
  assert.deepEqual(dryRun('rerun-failed'), rerun);
  // The same commands when this process runs inside a make that prints its directories (HY-83).
  assert.deepEqual(dryRun('rerun-failed', { env: { ...process.env, MAKEFLAGS: 'w', MAKELEVEL: '2' } }), rerun);
});

test('the active items are the task rows in state [~], with their titles', () => {
  assert.deepEqual(activeItems(CHECKLIST), [{ id: 'H1.2', title: 'Print `a \\| b` for a union' }]);
  assert.deepEqual(activeItems(DONE), []);
});

test('the decision refuses an active item, a dirty tree, a missing hook and a second run of a tree', () => {
  const clean = { mode: 'run', targets: ['a', 'b'], active: [], dirty: [], hooks: null, tree: 'tree-1', template: 'main-1', record: null, running: false };
  const fresh = decide(clean);
  assert.equal(fresh.run, true);
  assert.deepEqual(fresh.targets, ['a', 'b']);
  assert.match(fresh.reason, /no full-run record/);

  const active = decide({ ...clean, active: [{ id: 'H1.2', title: 'Print a union' }] });
  assert.equal(active.run, false);
  assert.match(active.reason, /1 active checklist item[\s\S]*H1\.2 Print a union/);

  const dirty = decide({ ...clean, dirty: [' M Makefile'] });
  assert.equal(dirty.run, false);
  assert.match(dirty.reason, /uncommitted tracked changes[\s\S]*M Makefile/);

  const hooks = decide({ ...clean, hooks: 'the pre-push hook is not installed: core.hooksPath is not set, not .githooks; run make hooks' });
  assert.equal(hooks.run, false);
  assert.match(hooks.reason, /pre-push hook is not installed[\s\S]*run make hooks/);

  const earlier = { tree: 'tree-1', template: 'main-1', result: 'passed', started: '2026-10-05T01:00:00.000Z', targets: [{ name: 'a', status: 'passed' }, { name: 'b', status: 'passed' }] };
  const second = decide({ ...clean, record: earlier });
  assert.equal(second.run, false);
  assert.match(second.reason, /full run of tree tree-1 with the template commit main-1 started 2026-10-05T01:00:00\.000Z with result passed/);

  // The same tree with another commit of the template tag is a new run (HY-80).
  const moved = decide({ ...clean, template: 'main-2', record: earlier });
  assert.equal(moved.run, true);
  assert.match(moved.reason, /the template commit main-2 differs from the template commit main-1 of the last full run/);

  const changed = decide({ ...clean, tree: 'tree-2', record: earlier });
  assert.equal(changed.run, true);
  assert.match(changed.reason, /differs from the tree tree-1/);
  assert.equal(decide({ ...clean, tree: 'tree-2', record: earlier, active: [{ id: 'H1.2', title: 'x' }] }).run, false);

  const running = decide({ ...clean, tree: 'tree-2', record: { ...earlier, result: 'incomplete', pid: 42 }, running: true });
  assert.equal(running.run, false);
  assert.match(running.reason, /process 42 is still running/);
});

test('the decision of rerun-failed needs a record of the current tree with targets that did not pass', () => {
  const clean = { mode: 'rerun-failed', targets: [], active: [], dirty: [], hooks: null, tree: 'tree-1', template: 'main-1', record: null, running: false };
  assert.match(decide(clean).reason, /no full-run record/);
  assert.equal(decide(clean).run, false);
  const failed = { tree: 'tree-1', template: 'main-1', result: 'failed', started: 's', targets: [{ name: 'a', status: 'passed' }, { name: 'b', status: 'failed' }, { name: 'c', status: 'pending' }] };
  assert.equal(decide({ ...clean, tree: 'tree-2', record: failed }).run, false);
  assert.match(decide({ ...clean, tree: 'tree-2', record: failed }).reason, /verified tree tree-1, not the current tree tree-2/);
  assert.equal(decide({ ...clean, template: 'main-2', record: failed }).run, false);
  assert.match(decide({ ...clean, template: 'main-2', record: failed }).reason, /verified the template commit main-1, not the current template commit main-2/);
  assert.deepEqual(decide({ ...clean, record: failed }).targets, ['b', 'c']);
  assert.equal(decide({ ...clean, record: { ...failed, result: 'passed', targets: [{ name: 'a', status: 'passed' }] } }).run, false);
  assert.equal(decide({ ...clean, record: failed, dirty: [' M x'] }).run, false);
  assert.equal(decide({ ...clean, record: failed, hooks: 'not installed' }).run, false);
});

test('a checkout without the pre-push hook installed refuses the run before any target', async t => {
  const directory = checkout(t, DONE);
  git(directory, 'config', '--unset', 'core.hooksPath');
  const { status, output, ran } = await guard(directory, 'run', ['a']);
  assert.equal(status, 1);
  assert.deepEqual(ran, []);
  assert.match(output, /^\[full-run\] refuse: the pre-push hook is not installed: core\.hooksPath is not set, not \.githooks; run make hooks/);
});

test('a checklist with an active item refuses the run before any target', async t => {
  const directory = checkout(t, CHECKLIST);
  const { status, output, ran } = await guard(directory, 'run', ['a', 'b']);
  assert.equal(status, 1);
  assert.deepEqual(ran, []);
  assert.match(output, /^\[full-run\] refuse: 1 active checklist item/);
  assert.match(output, /H1\.2 Print `a \\\| b` for a union/);
});

test('a dirty tree is refused', async t => {
  const directory = checkout(t, DONE);
  writeFileSync(path.join(directory, '.gitignore'), '/var/\n/build/\n');
  const { status, output, ran } = await guard(directory, 'run', ['a']);
  assert.equal(status, 1);
  assert.deepEqual(ran, []);
  assert.match(output, /uncommitted tracked changes[\s\S]*M \.gitignore/);
});

test('a full run records each target, and the same tree is refused a second time', async t => {
  const directory = checkout(t, DONE);
  const first = await guard(directory, 'run', ['a', 'b', 'c']);
  assert.equal(first.status, 0, first.output);
  assert.deepEqual(first.ran, ['a', 'b', 'c']);
  assert.match(first.output, /^\[full-run\] run: no full-run record/);
  const written = record(directory);
  assert.equal(written.tree, git(directory, 'rev-parse', 'HEAD^{tree}'));
  // The record names the run by its tree and the commit of the template tag, read when the guard starts (HY-80).
  assert.equal(written.template, templateTag(directory));
  assert.match(first.output, new RegExp(`^\\[full-run\\] template commit ${written.template} of the tag v0\\.0\\.1 of var/template$`, 'm'));
  assert.deepEqual(Object.keys(written).sort(), ['ended', 'environment', 'failed', 'pid', 'reruns', 'result', 'started', 'targets', 'template', 'tree']);
  // The record holds the running releases of the tools, the PHP patch among them, as the evidence of the run (HY-81).
  assert.equal(written.environment.node, process.version);
  assert.match(written.environment.php, /^\d+\.\d+\.\d+$/);
  assert.equal(written.result, 'passed');
  assert.ok(written.ended);
  assert.deepEqual(written.targets.map(target => target.status), ['passed', 'passed', 'passed']);

  const second = await guard(directory, 'run', ['a', 'b', 'c']);
  assert.equal(second.status, 1);
  assert.deepEqual(second.ran, []);
  assert.match(second.output, new RegExp(`refuse: the full run of tree ${written.tree} with the template commit ${written.template} started ${written.started} with result passed`));

  // A new commit of the branch main of the template repository leaves the run of the tag as it is.
  const next = commitTemplate(directory, 'next');
  const branchMoved = await guard(directory, 'run', ['a']);
  assert.equal(branchMoved.status, 1);
  assert.deepEqual(branchMoved.ran, []);
  assert.match(branchMoved.output, new RegExp(`refuse: the full run of tree ${written.tree} with the template commit ${written.template} started`));

  // The tag at another commit permits a new full run of the same tree.
  tagTemplate(directory, next);
  const moved = await guard(directory, 'run', ['a']);
  assert.equal(moved.status, 0, moved.output);
  assert.match(moved.output, new RegExp(`the template commit ${next} differs from the template commit ${written.template}`));
  assert.equal(record(directory).template, next);

  commit(directory, 'next.txt', 'next\n');
  const changed = await guard(directory, 'run', ['a']);
  assert.equal(changed.status, 0, changed.output);
  assert.match(changed.output, /differs from the tree/);
});

test('rerun-failed without a record is refused', async t => {
  const directory = checkout(t, DONE);
  const { status, output, ran } = await guard(directory, 'rerun-failed', []);
  assert.equal(status, 1);
  assert.deepEqual(ran, []);
  assert.match(output, /refuse: no full-run record/);
});

test('rerun-failed reruns only the failed targets, and a passing rerun completes the result', async t => {
  const directory = checkout(t, DONE);
  const first = await guard(directory, 'run', ['a', 'b', 'c'], ['b']);
  assert.equal(first.status, 1);
  assert.deepEqual(first.ran, ['a', 'b', 'c']);
  assert.equal(record(directory).result, 'failed');
  assert.match(first.output, /failed: b/);

  const failing = await guard(directory, 'rerun-failed', [], ['b']);
  assert.equal(failing.status, 1);
  assert.deepEqual(failing.ran, ['b']);
  assert.equal(record(directory).result, 'failed');

  const passing = await guard(directory, 'rerun-failed', []);
  assert.equal(passing.status, 0, passing.output);
  assert.deepEqual(passing.ran, ['b']);
  const completed = record(directory);
  assert.equal(completed.result, 'passed');
  assert.deepEqual(completed.targets.map(target => target.status), ['passed', 'passed', 'passed']);
  assert.equal(completed.reruns.length, 2);

  const again = await guard(directory, 'rerun-failed', []);
  assert.equal(again.status, 1);
  assert.match(again.output, /passed; no target failed/);
});

test('a run that stops records the run as incomplete, and rerun-failed runs its unfinished targets', async t => {
  const directory = checkout(t, DONE);
  await assert.rejects(fullRun({
    root: directory,
    template: TEMPLATE,
    mode: 'run',
    targets: ['a', 'b', 'c'],
    print: () => {},
    runTarget: async name => {
      if (name === 'b') throw new Error('stopped');
      return { passed: true, lastLines: [] };
    },
  }), /stopped/);
  const stopped = record(directory);
  assert.equal(stopped.result, 'incomplete');
  assert.deepEqual(stopped.targets.map(target => target.status), ['passed', 'running', 'pending']);
  stopped.pid = 2 ** 22 + 1;
  writeFileSync(path.join(directory, RECORD), JSON.stringify(stopped));

  const second = await guard(directory, 'run', ['a', 'b', 'c']);
  assert.equal(second.status, 1);
  assert.match(second.output, /with result incomplete/);
  const rerun = await guard(directory, 'rerun-failed', []);
  assert.equal(rerun.status, 0, rerun.output);
  assert.deepEqual(rerun.ran, ['b', 'c']);
  assert.equal(record(directory).result, 'passed');
});

test('a second full run of the checkout that starts while the first runs fails with the holder of the lock', async t => {
  const directory = checkout(t, DONE);
  let finish;
  const waiting = new Promise(resolve => { finish = resolve; });
  let entered;
  const inside = new Promise(resolve => { entered = resolve; });
  const lines = [];
  const first = fullRun({ root: directory, template: TEMPLATE, mode: 'run', targets: ['a'], print: () => {}, runTarget: async () => { entered(); await waiting; return { passed: true, lastLines: [] }; } });
  await inside;
  const second = await fullRun({ root: directory, template: TEMPLATE, mode: 'rerun-failed', print: line => lines.push(line), runTarget: async () => ({ passed: true, lastLines: [] }) });
  assert.equal(second, 1);
  const third = await fullRun({ root: directory, template: TEMPLATE, mode: 'run', targets: ['b'], print: line => lines.push(line), runTarget: async () => ({ passed: true, lastLines: [] }) });
  assert.equal(third, 1);
  assert.match(lines.join('\n'), /refuse: another full run of this checkout: .*full-run\.lock is held by process \d+ of the checkout/);
  finish();
  assert.equal(await first, 0);
  assert.equal(existsSync(path.join(directory, 'var/full-run.lock')), false);
});

test('the record and the summary hold the last output lines of each failed target (HY-84)', async t => {
  const directory = checkout(t, DONE);
  const run = await guard(directory, 'run', ['a', 'b', 'c'], ['b']);
  assert.equal(run.status, 1);
  const written = record(directory);
  assert.deepEqual(written.targets.map(target => target.lastLines ?? null), [null, ['b: error 1', 'b: error 2'], null]);
  assert.match(run.output, /^\[full-run\] b failed; its last 2 lines:\n  \| b: error 1\n  \| b: error 2$/m);
});

test('a make target resolves its result with its last output lines, standard error included', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-full-run-make-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const lines = Array.from({ length: LAST_LINES + 5 }, (_, index) => `\t@echo line ${index}`).join('\n');
  writeFileSync(path.join(directory, 'Makefile'), `fails:\n${lines}\n\t@echo the cause >&2\n\t@exit 3\npasses:\n\t@echo fine\n`);
  const failed = await makeTarget(directory, 'fails');
  assert.equal(failed.passed, false);
  assert.equal(failed.lastLines.length, LAST_LINES);
  // The last lines hold the last output of the recipe on both streams. The line in which make names the failed recipe
  // differs between GNU Make 3.81 and 4 (`[fails]`, `[Makefile:28: fails]`), and make is not pinned (HY-81, HY-83).
  assert.ok(failed.lastLines.includes('the cause'), failed.lastLines.join('\n'));
  assert.ok(failed.lastLines.includes(`line ${LAST_LINES + 4}`), failed.lastLines.join('\n'));
  assert.ok(!failed.lastLines.includes('line 0'));
  assert.deepEqual(await makeTarget(directory, 'passes'), { passed: true, lastLines: ['fine'] });
});

test('a target whose output ends without a newline is followed by a line at column 0 (HY-84)', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-full-run-line-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(path.join(directory, 'Makefile'), "joined:\n\t@printf 'no newline'\n");
  const script = `import { makeTarget } from ${JSON.stringify(path.join(ROOT, 'scripts/full-run.mjs'))};
    const result = await makeTarget(${JSON.stringify(directory)}, 'joined');
    console.log('[full-run] next line ' + result.passed);`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, MAKEFLAGS: '', MAKELEVEL: '' } });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stdout.split('\n').includes('[full-run] next line true'), JSON.stringify(run.stdout));
});
