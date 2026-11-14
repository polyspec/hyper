// Tests `hyper check` (HR-96, HY-48.3) with an application whose region placements break HY-3 and HY-30: it checks
// the manifest and the template rules, reads no output and writes no file.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { requireNodeAddon } from './requires.mts';

// The command tool takes its rules from the Node binding of the core (HR-96).
requireNodeAddon();

// The relative paths below an application, in byte order.
const listing = (app: string) => readdirSync(app, { recursive: true, encoding: 'utf8' }).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const check = (app: string) => spawnSync(process.execPath, [resolve('packages/cli/bin/hyper.mjs'), 'check', '--app', app], { encoding: 'utf8' });

test('reports every region placement that breaks HY-3 and HY-30', () => {
  const result = check('tests/scripts/fixtures/regions');
  assert.equal(result.status, 1);
  assert.deepEqual(result.stderr.trim().split('\n'), [
    'layout.tpl: {# left} is not directly inside an element with id="left" (HY-3, HY-30)',
    'list.tpl: {# notice} has block arguments (HY-3, HY-30)',
    'list.tpl: {# rows} is not directly inside an element with id="rows" (HY-3, HY-30)',
    // A route region placed in an included template passes; one that no template of the route places fails (HY-75).
    'view.tpl: places {# lost} 0 times, expected once (HY-3, HY-30)',
  ]);
});

test('reports a layout that does not place {# build} exactly once (HY-125.7)', (t) => {
  const app = mkdtempSync(join(tmpdir(), 'hyper-check-templates-'));
  t.after(() => rmSync(app, { recursive: true, force: true }));
  cpSync('tests/scripts/fixtures/chunks', app, { recursive: true });
  const layout = join(app, 'templates/layout.tpl');
  const text = readFileSync(layout, 'utf8');
  assert.equal(check(app).status, 0, 'the fixture passes as it is');
  for (const [written, count] of [[text.replace('{# build}', ''), 0], [text.replace('{# build}', '{# build}{# build}'), 2]] as const) {
    writeFileSync(layout, written);
    const result = check(app);
    assert.equal(result.status, 1, result.stdout);
    assert.deepEqual(result.stderr.trim().split('\n'), [`layout.tpl: places {# build} ${count} times, expected once (HY-125)`]);
  }
});

test('checks the manifest (HY-2) and writes no file', (t) => {
  const app = mkdtempSync(join(tmpdir(), 'hyper-check-manifest-'));
  t.after(() => rmSync(app, { recursive: true, force: true }));
  cpSync('tests/scripts/fixtures/invalid-manifest', app, { recursive: true });
  const before = listing(app);
  const result = check(app);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /page region/);
  assert.deepEqual(listing(app), before);
});

test('accepts the board example', () => {
  const result = check('examples/board');
  assert.equal(result.status, 0, result.stderr);
});
