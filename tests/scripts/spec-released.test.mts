// The check of the released statement ids (scripts/spec-docs.mts released, H35.98) over a Git repository of its own:
// the fixture released.json is committed and tagged v0.0.1, and a variant of the contract is the tree. A released id that
// is missing and not retired fails, a released id whose section, rule or words changed (the topic) fails, a wording edit
// and a retired id pass, and a released text that moved to another id is printed without a failure. The baseline of
// config/spec-baseline.json must name the newest version of CHANGELOG.md that has a tag.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { assertFails, runScript, type ScriptResult } from './script-run.mts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const fixture = path.join(here, 'fixtures', 'spec-released');
const script = path.join(repo, 'scripts', 'spec-docs.mts');

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

// Git runs without the configuration of the machine, so that no hook, signing or template of a user acts on the fixture.
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

function git(root: string, ...args: string[]): void {
  const result = spawnSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd: root, env: GIT_ENV, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
}

const changelog = (versions: string[]): string => `# Changelog\n\n## Unreleased\n\n${versions.map((v) => `## ${v}\n\n- A change.\n`).join('\n')}`;

/**
 * A repository whose commit tagged v0.0.1 holds released.json as its contract, with `variant` as the contract of the
 * tree, the baseline `baseline` and the change log of `versions`; `tags` are tagged at that commit too.
 */
function makeRoot(variant: string, options: { baseline?: string; versions?: string[]; tags?: string[] } = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'spec-released-'));
  roots.push(root);
  mkdirSync(path.join(root, 'contracts'));
  mkdirSync(path.join(root, 'config'));
  git(root, 'init', '-q');
  cpSync(path.join(fixture, 'released.json'), path.join(root, 'contracts', 'protocol.json'));
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'released');
  for (const tag of ['v0.0.1', ...(options.tags ?? [])]) git(root, 'tag', tag);
  cpSync(path.join(fixture, variant), path.join(root, 'contracts', 'protocol.json'));
  writeFileSync(path.join(root, 'config', 'spec-baseline.json'), `${JSON.stringify({ version: options.baseline ?? '0.0.1' }, null, 2)}\n`);
  writeFileSync(path.join(root, 'CHANGELOG.md'), changelog(options.versions ?? ['0.0.1']));
  return root;
}

function run(root: string): ScriptResult {
  return runScript(script, ['released', '--root', root], GIT_ENV);
}

test('the released contract itself passes and names the count of the released ids it compared', () => {
  const result = run(makeRoot('released.json'));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /3 released statement ids of v0\.0\.1/u);
});

test('a wording edit, a renamed code span and a renumbered citation keep the topic', () => {
  const result = run(makeRoot('wording.json'));
  assert.equal(result.status, 0, result.stderr);
});

test('a released id that is retired, alone or with its rule, passes', () => {
  const result = run(makeRoot('retired.json'));
  assert.equal(result.status, 0, result.stderr);
});

test('a released id that is missing and not retired fails', () => {
  assertFails(run(makeRoot('missing.json')), ['HY-1.2 of v0.0.1 is missing and not retired', 'HY-2.1 of v0.0.1 is missing and not retired']);
});

test('a released id reused for another topic fails, and its moved text is printed', () => {
  const result = run(makeRoot('reuse.json'));
  assertFails(result, ['HY-1.1 of v0.0.1 changed its topic: section Actions -> Errors', 'HY-1.2 of v0.0.1 changed its topic']);
  assert.ok(result.stdout.includes('the text of HY-1.1 of v0.0.1 is now HY-3.1'), result.stdout);
});

test('a baseline whose tag is missing fails and names the tag', () => {
  assertFails(run(makeRoot('released.json', { baseline: '0.0.9', versions: ['0.0.9'] })), ['the tag v0.0.9 of config/spec-baseline.json is missing']);
});

test('at a version-bump commit the baseline is the version below the new section, which has no tag yet', () => {
  const result = run(makeRoot('released.json', { versions: ['0.0.2', '0.0.1'] }));
  assert.equal(result.status, 0, result.stderr);
});

test('a baseline below the newest tagged version of the change log is stale and fails', () => {
  assertFails(run(makeRoot('released.json', { versions: ['0.0.2', '0.0.1'], tags: ['v0.0.2'] })), ['config/spec-baseline.json names 0.0.1; the newest version of CHANGELOG.md with a tag is 0.0.2']);
});
