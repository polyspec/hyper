// The PHP session worker runs phpredis with a setting that shares the sessions of a server (H35.81, HY-115.24): a
// phpredis peer shares them only with a `redis.session.lock_retries` other than -1, so neither the ini setting nor the
// retries of RedisClusterSessions default to -1. The test reads the tracked worker.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const WORKER = 'tests/scripts/fixtures/session-worker/worker.php';
const RETRIES = /getenv\('HYPER_SESSION_RETRIES'\)\s*\?:\s*'?(-?\d+)'?/g;

test('HY-115.24: the PHP worker tries a lock a finite number of times', () => {
  const defaults = [...readFileSync(WORKER, 'utf8').matchAll(RETRIES)].map((match) => match[1]);
  assert.equal(defaults.length, 2, `${WORKER}: expected the two defaults of HYPER_SESSION_RETRIES, found ${defaults.length}`);
  for (const value of defaults) {
    assert.notEqual(value, '-1', `${WORKER}: lock_retries defaults to -1, which HY-115.24 excludes`);
  }
});
