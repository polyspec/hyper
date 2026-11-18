// The check of the released statement ids (scripts/spec-docs.mts released, H35.98) over a Git repository of its own.
// The baseline is the newest tag vX.Y.Z reachable from HEAD that does not point at HEAD: at a release commit it is the
// previous release, and at a later commit the latest one. The fixture released.json is committed and tagged v0.0.1,
// and a variant of the contract is committed after it. A released id that is missing and not retired fails, a released
// id whose section, rule or words changed (the topic) fails, a wording edit and a retired id pass, and a released text
// that moved to another id is printed without a failure.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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

/** Commits `contract` of the fixture as contracts/protocol.json, and tags the commit with `tag` when it is given. */
function commit(root: string, contract: string, tag?: string): void {
  cpSync(path.join(fixture, contract), path.join(root, 'contracts', 'protocol.json'));
  git(root, 'add', '.');
  git(root, 'commit', '-q', '--allow-empty', '-m', contract);
  if (tag !== undefined) git(root, 'tag', '-a', tag, '-m', tag);
}

/** A repository with the commits `[contract, tag?]` in their order; the last one is HEAD. */
function makeRepository(commits: [string, string?][]): string {
  const root = mkdtempSync(path.join(tmpdir(), 'spec-released-'));
  roots.push(root);
  mkdirSync(path.join(root, 'contracts'));
  git(root, 'init', '-q');
  for (const [contract, tag] of commits) commit(root, contract, tag);
  return root;
}

/** The released contract tagged v0.0.1, and `variant` committed after it as HEAD. */
const makeRoot = (variant: string): string => makeRepository([['released.json', 'v0.0.1'], [variant]]);

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

test('a commit after a tag compares with that tag', () => {
  const root = makeRepository([['released.json', 'v0.0.1'], ['wording.json', 'v0.0.2'], ['wording.json']]);
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /released statement ids of v0\.0\.2/u);
});

test('a tagged release commit compares with the previous tag, not with its own', () => {
  const root = makeRepository([['released.json', 'v0.0.1'], ['reuse.json', 'v0.0.2']]);
  assertFails(run(root), ['HY-1.1 of v0.0.1 changed its topic']);
});

test('a repository with no release tag reachable from HEAD fails and says why', () => {
  const root = makeRepository([['released.json']]);
  assertFails(run(root), ['no tag vX.Y.Z is reachable from HEAD']);
});
