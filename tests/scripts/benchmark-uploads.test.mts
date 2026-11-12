// The benchmark of the uploads runs each implementation and reports what it measured (HY-131).
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { requireBuilt } from './requires.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('the benchmark of the uploads measures each implementation for each body', { timeout: 300_000 }, async () => {
  requireBuilt('packages', 'packages/ts/dist/index.js');
  requireBuilt('hyper-install-python', 'packages/python/.venv/bin/python');
  requireBuilt('hyper-install-php', 'vendor/autoload.php');
  const { stdout } = await promisify(execFile)(process.execPath, ['benchmarks/uploads.mts', '--size', '1048576', '--runs', '2', '--json'], { cwd: ROOT, maxBuffer: 1 << 24 });
  const results: unknown = JSON.parse(stdout.trim().split('\n').at(-1) ?? '');
  assert.ok(Array.isArray(results));
  const implementations = ['PHP itself (PHP-FPM)', 'hyper PHP (PHP-FPM)', 'hyper Node (App.server)', 'hyper Python (http.server)'];
  const measured = new Map<string, number>();
  for (const result of results as Iterable<{ implementation: string; requests: number; valid: boolean; wallMs: { mean: number }; cpuMs: { mean: number }; maxRssBytes: number }>) {
    measured.set(result.implementation, (measured.get(result.implementation) ?? 0) + 1);
    assert.equal(result.requests, 2);
    assert.equal(result.valid, true, `${result.implementation} did not read a body`);
    assert.ok(result.wallMs.mean > 0 && result.cpuMs.mean >= 0 && result.maxRssBytes > 0);
  }
  // Each implementation measured the three bodies.
  assert.deepEqual([...measured], implementations.map((name) => [name, 3]));
});
