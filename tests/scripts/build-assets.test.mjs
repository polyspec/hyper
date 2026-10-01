// Tests that scripts/build-assets.mjs checks the manifest before it writes any output (HY-2).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { test } from 'node:test';

test('rejects an invalid manifest and writes nothing', () => {
  const app = 'tests/scripts/fixtures/invalid-manifest';
  const result = spawnSync(process.execPath, ['scripts/build-assets.mjs', '--app', app, '--api', '/api'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /page region/);
  assert.equal(existsSync(`${app}/public`), false);
  assert.equal(existsSync(`${app}/build`), false);
});
