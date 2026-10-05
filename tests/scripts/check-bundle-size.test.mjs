// Tests scripts/check-bundle-size.mjs: a build whose index names no template file fails with the expected and the
// actual count instead of passing or failing with a TypeError (HY-84).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('a build without template files fails with the expected and the actual count', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-bundle-size-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ hyper: '/assets/hyper-A.js' }));
  writeFileSync(path.join(directory, 'templates.index.json'), '{}');
  writeFileSync(path.join(directory, 'limits.json'), JSON.stringify({ limits: { ssrScript: 1, csrShell: 1, largestTemplate: 1 } }));
  const run = spawnSync(process.execPath, ['scripts/check-bundle-size.mjs', '--app', directory, '--output', directory, '--limits', path.join(directory, 'limits.json')], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /templates\.index\.json names no template file; expected at least 1, actual 0/);
});
