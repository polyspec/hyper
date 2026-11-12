// The benchmark of the Redis sessions runs each server and reports what it counted (HY-115).
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { requireBuilt } from './requires.mts';
import { NAMES, ROOT } from './session-workers.mts';

interface Result { server: string; processes: number; requests: number; requestsPerSecond: number }

test('the benchmark of the Redis sessions counts the requests of each server', { timeout: 120_000 }, async () => {
  requireBuilt('hyper-install-redis', 'var/redis/redis-server', 'var/redis/redis.so');
  requireBuilt('packages', 'packages/ts/dist/index.js');
  requireBuilt('hyper-install-python', 'packages/python/.venv/bin/python');
  requireBuilt('hyper-install-php', 'vendor/autoload.php');
  const { stdout } = await promisify(execFile)(process.execPath, ['benchmarks/sessions.mts', '--requests', '5', '--json'], { cwd: ROOT });
  const results: unknown = JSON.parse(stdout);
  assert.ok(Array.isArray(results));
  assert.deepEqual(results.map(({ server, processes, requests }: Result) => [server, processes, requests]), NAMES.flatMap((name) => [[name, 1, 5], [name, 4, 20]]));
  for (const { requestsPerSecond } of results as Iterable<Result>) assert.ok(requestsPerSecond > 0);
});
