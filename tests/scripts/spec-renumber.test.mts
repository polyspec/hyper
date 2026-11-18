// The renumbering of statement and rule ids (scripts/spec-renumber.mts, H35.98) over a Git repository of its own that
// holds the fixture tree: a swap of the rules HY-1 and HY-2 renames the contract and every tracked citation, writes the
// koSource of a changed text again, leaves the change log, the plans and the generated protocol documents as they are,
// and a second run of the same map writes nothing.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { assertFails, runScript, type ScriptResult } from './script-run.mts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const fixture = path.join(here, 'fixtures', 'spec-renumber');
const script = path.join(repo, 'scripts', 'spec-renumber.mts');
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const UNCHANGED = ['CHANGELOG.md', 'docs/plans/plan.md', 'docs/spec/protocol.md'];
const RENAMED = ['contracts/protocol.json', 'src/citations.txt'];

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A repository whose tracked files are the fixture tree. */
function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'spec-renumber-'));
  roots.push(root);
  cpSync(path.join(fixture, 'tree'), root, { recursive: true });
  const result = spawnSync('git', ['init', '-q'], { cwd: root, env: GIT_ENV, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(spawnSync('git', ['add', '.'], { cwd: root, env: GIT_ENV }).status, 0);
  return root;
}

function run(root: string, ...args: string[]): ScriptResult {
  return runScript(script, [...args, '--root', root], GIT_ENV);
}

/** The map of renames `[from, to]`, with the anchor of each `from` that the tool prints, written into the root. */
function writeMap(root: string, renames: [string, string][]): string {
  const printed = run(root, 'anchor', ...renames.map(([from]) => from));
  assert.equal(printed.status, 0, printed.stderr);
  const anchors = new Map<string, string>();
  for (const line of printed.stdout.trim().split('\n')) {
    const [id, anchor] = line.split(' ');
    if (id !== undefined && anchor !== undefined) anchors.set(id, anchor);
  }
  const file = path.join(root, 'map.json');
  writeFileSync(file, `${JSON.stringify({ renames: renames.map(([from, to]) => ({ from, to, anchor: anchors.get(from) })) }, null, 2)}\n`);
  return file;
}

const read = (root: string, file: string): string => readFileSync(path.join(root, file), 'utf8');

test('a swap of two rules renames the contract and the citations, and writes the koSource of a changed text again', () => {
  const root = makeRoot();
  const map = writeMap(root, [['HY-1', 'HY-2'], ['HY-2', 'HY-1']]);
  const result = run(root, 'apply', '--map', map);
  assert.equal(result.status, 0, result.stderr);
  for (const file of RENAMED) assert.equal(read(root, file), readFileSync(path.join(fixture, 'expected', file), 'utf8'), file);
  for (const file of UNCHANGED) assert.equal(read(root, file), readFileSync(path.join(fixture, 'tree', file), 'utf8'), file);
});

test('a second run of the same map writes nothing', () => {
  const root = makeRoot();
  const map = writeMap(root, [['HY-1', 'HY-2'], ['HY-2', 'HY-1']]);
  assert.equal(run(root, 'apply', '--map', map).status, 0);
  const first = RENAMED.map((file) => read(root, file));
  const second = run(root, 'apply', '--map', map);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /is applied; nothing to write/u);
  assert.deepEqual(RENAMED.map((file) => read(root, file)), first);
});

test('a statement rename moves one id and the citations of it', () => {
  const root = makeRoot();
  const map = writeMap(root, [['HY-1.2', 'HY-1.3']]);
  assert.equal(run(root, 'apply', '--map', map).status, 0);
  assert.ok(read(root, 'contracts/protocol.json').includes('"id": "HY-1.3", "en": "An outside location is absolute."'));
  assert.ok(read(root, 'contracts/protocol.json').includes('kinds (HY-1.3)'));
  assert.equal(read(root, 'src/citations.txt').split('\n')[1], "export const cited = ['HY-1.3', 'HY-2.1'];");
});

test('an anchor that no id of the contract holds fails and writes nothing', () => {
  const root = makeRoot();
  const file = path.join(root, 'map.json');
  writeFileSync(file, JSON.stringify({ renames: [{ from: 'HY-1', to: 'HY-3', anchor: '0'.repeat(64) }] }));
  assertFails(run(root, 'apply', '--map', file), ['the anchor of HY-1 -> HY-3 is at no id']);
  for (const name of RENAMED) assert.equal(read(root, name), readFileSync(path.join(fixture, 'tree', name), 'utf8'));
});

test('a map that renames a rule id to a statement id fails', () => {
  const root = makeRoot();
  const file = path.join(root, 'map.json');
  writeFileSync(file, JSON.stringify({ renames: [{ from: 'HY-1', to: 'HY-3.1', anchor: '0'.repeat(64) }] }));
  assertFails(run(root, 'apply', '--map', file), ['both are rule ids or both statement ids']);
});
