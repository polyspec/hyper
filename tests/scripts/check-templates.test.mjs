// Tests scripts/check-templates.mjs with an application whose region placements break HY-3 and HY-30.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('reports every region placement that breaks HY-3 and HY-30', () => {
  const result = spawnSync(process.execPath, ['scripts/check-templates.mjs', '--app', 'tests/scripts/fixtures/regions'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.deepEqual(result.stderr.trim().split('\n'), [
    'layout.tpl: {# left} is not directly inside an element with id="left" (HY-3, HY-30)',
    'list.tpl: {# notice} has block arguments (HY-3, HY-30)',
    'list.tpl: {# rows} is not directly inside an element with id="rows" (HY-3, HY-30)',
  ]);
});

test('accepts the board example', () => {
  const result = spawnSync(process.execPath, ['scripts/check-templates.mjs', '--app', 'examples/board'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
