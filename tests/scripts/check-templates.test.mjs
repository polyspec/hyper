// Tests scripts/check-templates.mjs and the check in hyper-build-server with an application whose region
// placements break HY-3 and HY-30.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// The template repository of the build, as the Makefile passes it.

test('reports every region placement that breaks HY-3 and HY-30', () => {
  const result = spawnSync(process.execPath, ['scripts/check-templates.mjs', '--app', 'tests/scripts/fixtures/regions'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.deepEqual(result.stderr.trim().split('\n'), [
    'layout.tpl: {# left} is not directly inside an element with id="left" (HY-3, HY-30)',
    'list.tpl: {# notice} has block arguments (HY-3, HY-30)',
    'list.tpl: {# rows} is not directly inside an element with id="rows" (HY-3, HY-30)',
    // A route region placed in an included template passes; one that no template of the route places fails (HY-75).
    'view.tpl: places {# lost} 0 times, expected once (HY-3, HY-30)',
  ]);
});

test('accepts the board example', () => {
  const result = spawnSync(process.execPath, ['scripts/check-templates.mjs', '--app', 'examples/board'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('the server build fails and writes nothing for templates that break HY-3 and HY-30 (HY-48)', () => {
  const output = mkdtempSync(join(tmpdir(), 'hyper-build-server-'));
  rmSync(output, { recursive: true });
  try {
    const result = spawnSync(process.execPath, ['packages/hyper-build/bin/hyper-build-server.mjs', '--manifest', 'tests/scripts/fixtures/regions/app/app.json', '--templates', 'tests/scripts/fixtures/regions/templates', '--output', output, '--php-namespace', 'Fixture\\Program'], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /view\.tpl: places \{# lost\} 0 times, expected once \(HY-3, HY-30\)/);
    assert.equal(existsSync(output), false);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
