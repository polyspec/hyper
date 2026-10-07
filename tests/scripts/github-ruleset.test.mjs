// Tests the GitHub ruleset of main and the merge settings (scripts/github-ruleset.mjs, HY-94). Each case copies the
// script and a declaration into a temporary directory and runs it with a fake `gh`, which `--gh` names. The fake keeps
// its state in a JSON file, answers as the REST API does and logs every call, so a case asserts the requests that apply
// sends and the result of check without reaching GitHub. A case runs the script as a child that it awaits, so the
// timeout of the case fails a script that never ends, and the case stops the child when it ends.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { dryRun } from './make-dry-run.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = 'scripts/github-ruleset.mjs';
const DECLARATION = JSON.parse(readFileSync(path.join(ROOT, '.github/ruleset.json'), 'utf8'));
const REPOSITORY = DECLARATION.repository;
const WORKFLOWS = path.join(ROOT, '.github/workflows');

const FAKE_GH = String.raw`
const fs = require('node:fs');
const statePath = process.env.FAKE_STATE;
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const args = process.argv.slice(2);
const method = args[args.indexOf('--method') + 1];
const apiPath = args[args.indexOf('--include') + 1];
const body = args.includes('--input') ? JSON.parse(fs.readFileSync(0, 'utf8') || 'null') : undefined;
state.calls.push(['gh', method, apiPath, ...(body === undefined ? [] : [body])]);
const repo = 'repos/' + state.repository;

function answer(status, payload) {
  fs.writeFileSync(statePath, JSON.stringify(state));
  process.stdout.write('HTTP/2.0 ' + status + ' X\r\nContent-Type: application/json\r\n\r\n' + (payload === undefined ? '' : JSON.stringify(payload)));
  process.exit(status >= 400 ? 1 : 0);
}

const stored = (ruleset, id) => ({ ...ruleset, id, source: state.repository, source_type: 'Repository', node_id: 'RRS_' + id,
  _links: { self: { href: 'https://api.github.com/' + repo + '/rulesets/' + id } }, created_at: '2026-10-06T00:00:00Z',
  updated_at: '2026-10-06T00:00:00Z', current_user_can_bypass: 'never' });

if (apiPath === repo && method === 'GET') answer(200, { full_name: state.repository, id: 1, ...state.settings });
if (apiPath === repo && method === 'PATCH') {
  Object.assign(state.settings, body);
  answer(200, { full_name: state.repository, ...state.settings });
}
if (apiPath.startsWith(repo + '/rulesets?') && method === 'GET') answer(200, state.rulesets.map(r => ({ id: r.id, name: r.name, target: r.target })));
if (apiPath === repo + '/rulesets' && method === 'POST') {
  state.rulesets.push(stored(body, 100 + state.rulesets.length));
  answer(201, state.rulesets.at(-1));
}
if (apiPath.startsWith(repo + '/rulesets/')) {
  const id = Number(apiPath.split('/').at(-1));
  const index = state.rulesets.findIndex(r => r.id === id);
  if (method === 'PUT') state.rulesets[index] = stored(body, id);
  answer(200, state.rulesets[index]);
}
answer(404, { message: 'Not Found' });
`;

/** A live ruleset of GitHub: the declared one with the fields that GitHub adds. */
function live(ruleset, id = 7) {
  return { ...structuredClone(ruleset), id, source: REPOSITORY, source_type: 'Repository', _links: {}, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', current_user_can_bypass: 'never' };
}

/** The script, a declaration and the fake gh in a temporary directory; the live settings are the declared ones. */
function sandbox(t, state = {}, declaration = DECLARATION) {
  const root = mkdtempSync(path.join(tmpdir(), 'hyper-github-ruleset-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ['scripts', '.github', 'bin']) mkdirSync(path.join(root, directory));
  copyFileSync(path.join(ROOT, SCRIPT), path.join(root, SCRIPT));
  writeFileSync(path.join(root, '.github/ruleset.json'), JSON.stringify(declaration));
  writeFileSync(path.join(root, 'bin', 'gh'), `#!${process.execPath}\n${FAKE_GH}`);
  chmodSync(path.join(root, 'bin', 'gh'), 0o755);
  const statePath = path.join(root, 'state.json');
  writeFileSync(statePath, JSON.stringify({ repository: REPOSITORY, calls: [], rulesets: [], settings: { ...declaration.settings }, ...state }));
  const read = () => JSON.parse(readFileSync(statePath, 'utf8'));
  return {
    state: read,
    calls: kind => read().calls.filter(call => kind === undefined || call[0] === kind),
    /** Runs the script to its end: { status, stdout, stderr }. */
    run(mode) {
      const child = spawn(process.execPath, [SCRIPT, mode, '--gh', path.join(root, 'bin', 'gh')], { cwd: root, env: { ...process.env, FAKE_STATE: statePath }, stdio: ['ignore', 'pipe', 'pipe'] });
      t.after(() => child.exitCode === null && child.signalCode === null && child.kill('SIGKILL'));
      const result = { status: null, stdout: '', stderr: '' };
      child.stdout.setEncoding('utf8').on('data', chunk => (result.stdout += chunk));
      child.stderr.setEncoding('utf8').on('data', chunk => (result.stderr += chunk));
      return new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', status => resolve({ ...result, status }));
      });
    },
  };
}

test('main takes changes only through pull requests and the merge queue, without a bypass actor (HY-94)', () => {
  const { ruleset } = DECLARATION;
  assert.equal(REPOSITORY, 'polyspec/hyper');
  assert.equal(ruleset.enforcement, 'active');
  assert.equal(ruleset.target, 'branch');
  assert.deepEqual(ruleset.bypass_actors, []);
  assert.deepEqual(ruleset.conditions.ref_name.include, ['refs/heads/main']);
  const rules = Object.fromEntries(ruleset.rules.map(rule => [rule.type, rule.parameters]));
  assert.deepEqual(Object.keys(rules).sort(), ['deletion', 'merge_queue', 'non_fast_forward', 'pull_request', 'required_linear_history', 'required_status_checks']);
  assert.equal(rules.pull_request.required_approving_review_count, 0);
  // The merge queue merges with its own method. gh pr merge --auto asks GitHub for auto-merge with a method of its own
  // choice (SQUASH); a method that this rule does not allow leaves the pull request out of the queue, so the rule allows
  // every method, and the queue and required_linear_history decide.
  assert.deepEqual(rules.pull_request.allowed_merge_methods, ['merge', 'squash', 'rebase']);
  // GitHub turns this on by default; with no approval required, a one-owner repository asks for none.
  assert.equal(rules.pull_request.require_extra_approval_for_unattributed_changes, false);
  // Each commit of a pull request lands on main as it is, rebased, so history stays linear.
  assert.equal(rules.merge_queue.merge_method, 'REBASE');
  assert.equal(rules.required_status_checks.strict_required_status_checks_policy, false);
  // gh pr merge --auto --rebase needs auto-merge and the rebase method; the merged branch is deleted.
  assert.deepEqual(DECLARATION.settings, { allow_rebase_merge: true, allow_auto_merge: true, delete_branch_on_merge: true });
});

test('the required checks are the job of the push gate and the job ci-passed of the full suite (HY-94)', () => {
  const checks = DECLARATION.ruleset.rules.find(rule => rule.type === 'required_status_checks').parameters.required_status_checks;
  // The check of a job without a name is the job ID; push-gate.yml has one job and gives it no name.
  const gate = readFileSync(path.join(WORKFLOWS, 'push-gate.yml'), 'utf8');
  assert.deepEqual([...gate.split('\njobs:\n')[1].matchAll(/^ {2}([\w-]+):\s*$/gm)].map(match => match[1]), ['push-gate']);
  assert.doesNotMatch(gate, /^ {4}name:/m);
  // ci-passed, the last job of ci.yml, passes only when every other job of ci.yml passed (ci-workflow.test.mjs), so it
  // stands for the whole workflow; it has no name, so its check is its job ID.
  const ci = readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
  assert.equal([...ci.split('\njobs:\n')[1].matchAll(/^ {2}([\w-]+):\s*$/gm)].map(match => match[1]).at(-1), 'ci-passed');
  assert.doesNotMatch(ci.split('\n  ci-passed:\n')[1], /^ {4}name:/m);
  // 15368 is the GitHub Actions app, so a status of the same name from another app does not satisfy the rule.
  assert.deepEqual(checks, ['push-gate', 'ci-passed'].map(context => ({ context, integration_id: 15368 })));
});

test('the Makefile runs the script for each target with the GitHub CLI of GH and publishes nothing (HY-94)', () => {
  for (const [target, mode] of [['github-ruleset', 'apply'], ['github-ruleset-check', 'check']]) {
    assert.deepEqual(dryRun(target), [`node scripts/github-ruleset.mjs ${mode} --gh gh`]);
    assert.deepEqual(dryRun(target, { variables: ['GH=/opt/gh'] }), [`node scripts/github-ruleset.mjs ${mode} --gh /opt/gh`]);
  }
  const makefile = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  assert.doesNotMatch(makefile, /^push:/m);
  assert.ok(!/^\.PHONY: (.*)$/m.exec(makefile)[1].split(' ').includes('push'));
  const suite = /^CHECK_TARGETS := (.*)$/m.exec(makefile)[1].split(' ');
  assert.deepEqual(suite.filter(name => ['github-ruleset', 'github-ruleset-check'].includes(name)), [], 'a target of the full suite reaches the GitHub API');
});

test('check fails without the ruleset and apply creates it', async t => {
  const box = sandbox(t);
  const result = await box.run('check');
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /\[ruleset\] differs: ruleset: live null, declared "main"/);
  assert.match(result.stderr, /run make github-ruleset/);
  assert.deepEqual(box.calls('gh').map(call => call[1]), ['GET', 'GET'], 'check only reads');
  const applied = await box.run('apply');
  assert.equal(applied.status, 0, applied.stderr);
  assert.deepEqual(box.calls('gh').filter(call => call[1] === 'POST'), [['gh', 'POST', `repos/${REPOSITORY}/rulesets`, DECLARATION.ruleset]]);
  const again = await box.run('check');
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /the repository matches \.github\/ruleset\.json/);
});

test('the order and the fields that GitHub adds are not differences', async t => {
  const ruleset = live(DECLARATION.ruleset);
  ruleset.rules.reverse();
  ruleset.conditions = { ref_name: { exclude: [], include: ['refs/heads/main'] } };
  const result = await sandbox(t, { rulesets: [ruleset] }).run('check');
  assert.equal(result.status, 0, result.stderr);
});

test('a bypass actor differs, and apply replaces only the ruleset of the name', async t => {
  const ruleset = live(DECLARATION.ruleset);
  ruleset.bypass_actors = [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }];
  const other = live({ ...DECLARATION.ruleset, name: 'tags', target: 'tag' }, 8);
  const box = sandbox(t, { rulesets: [other, ruleset] });
  const result = await box.run('check');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[ruleset\] differs: bypass_actors: live \[\{"actor_id":5,/);
  assert.match(result.stderr, /declared \[\]/);
  const applied = await box.run('apply');
  assert.equal(applied.status, 0, applied.stderr);
  assert.deepEqual(box.calls('gh').filter(call => call[1] !== 'GET'), [['gh', 'PUT', `repos/${REPOSITORY}/rulesets/7`, DECLARATION.ruleset]]);
  assert.equal((await box.run('check')).status, 0);
  assert.equal(box.state().rulesets[0].name, 'tags', 'apply changes only the ruleset of the name');
});

test('a missing rule, another check and a disabled enforcement each differ', async t => {
  const ruleset = live(DECLARATION.ruleset);
  ruleset.enforcement = 'evaluate';
  ruleset.rules = ruleset.rules.filter(rule => rule.type !== 'non_fast_forward');
  ruleset.rules.find(rule => rule.type === 'required_status_checks').parameters.required_status_checks = [{ context: 'ci', integration_id: 15368 }];
  const result = await sandbox(t, { rulesets: [ruleset] }).run('check');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[ruleset\] differs: enforcement: live "evaluate", declared "active"/);
  assert.match(result.stderr, /\[ruleset\] differs: rules: live \[\{"parameters":/);
  assert.match(result.stderr, /"context":"ci"/);
  assert.equal(result.stderr.match(/\[ruleset\] differs:/g).length, 2, result.stderr);
});

test('two rulesets of the name fail with both ids', async t => {
  const box = sandbox(t, { rulesets: [live(DECLARATION.ruleset, 7), live(DECLARATION.ruleset, 9)] });
  for (const mode of ['check', 'apply']) {
    const result = await box.run(mode);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`${REPOSITORY} has 2 rulesets named main \\(ids 7, 9\\); delete all but one`));
  }
  assert.deepEqual(box.calls('gh').map(call => call[1]), ['GET', 'GET', 'GET', 'GET']);
});

test('a setting that differs fails check, and apply patches only the declared settings', async t => {
  const box = sandbox(t, { rulesets: [live(DECLARATION.ruleset)], settings: { ...DECLARATION.settings, allow_auto_merge: false } });
  const result = await box.run('check');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[ruleset\] differs: settings\.allow_auto_merge: live false, declared true/);
  const applied = await box.run('apply');
  assert.equal(applied.status, 0, applied.stderr);
  assert.deepEqual(box.calls('gh').filter(call => call[1] !== 'GET'), [['gh', 'PATCH', `repos/${REPOSITORY}`, DECLARATION.settings]]);
  assert.equal((await box.run('check')).status, 0);
});

test('check names a missing merge queue', async t => {
  const ruleset = live(DECLARATION.ruleset);
  ruleset.rules = ruleset.rules.filter(rule => rule.type !== 'merge_queue');
  const result = await sandbox(t, { rulesets: [ruleset] }).run('check');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[ruleset\] differs: rules: live \[/);
  assert.match(result.stderr.split('declared')[1], /"merge_method":"REBASE"/);
});
