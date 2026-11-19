// A holder of the session tests leaves no process (H35.18, HR-84, HR-87): `holding` of session-redis-server.mts starts a
// request of a server that holds its session until a line of its input. A holder that ends before it holds the lock
// rejects with its status and its output, and its process has ended; a holder that still holds when a test ends is one
// of `holders`, which the hooks of a test file stop. Each wait is an event of the process: the rejection of `holding`
// and the exit that `stopServers` awaits. The holders are processes of the Node server over a session file of the test.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { stopServers } from '../../scripts/board-servers.mts';
import { NODE_ADDON, requireBuilt } from './requires.mts';
import { holders, holding } from './session-redis-server.mts';
import { IDENTIFIER } from './session-workers.mts';

let directory = '';

before(() => {
  requireBuilt('packages', 'packages/ts/dist/index.js');
  requireBuilt('node-addon', NODE_ADDON);
  directory = mkdtempSync(path.join(tmpdir(), 'hyper-session-holder-'));
  writeFileSync(path.join(directory, `sess_${IDENTIFIER}`), 'a:1:{s:1:"n";i:0;}');
});

// The directory is removed only after the processes that use it have exited (HR-87).
after(async () => {
  await stopServers(holders);
  rmSync(directory, { recursive: true, force: true });
});

/** Whether a process of the system has the id `pid`. */
function running(pid: number | undefined): boolean {
  assert.ok(pid !== undefined, 'the holder was started');
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    assert.equal(error instanceof Error && 'code' in error ? error.code : undefined, 'ESRCH', String(error));
    return false;
  }
}

test('a holder that ends before it holds the lock rejects with its status and its output, and its process has ended (HR-84)', async () => {
  // The worker command `write` without its values fails in the request, before the worker prints a line.
  const started = holders.length;
  await assert.rejects(holding('node', directory, {}, 'write'), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /^the node holder \(write\) ended with 1 before it held the lock:\n/u);
    assert.match(error.message, /TypeError/u, 'the message holds the output of the holder');
    return true;
  });
  assert.equal(holders.length, started + 1, 'the holder is one of the holders that the hooks stop');
  const holder = holders.at(-1);
  assert.ok(holder);
  assert.equal(holder.exitCode, 1);
  assert.equal(running(holder.pid), false, 'the process of the holder has ended');
  assert.deepEqual([holder.listenerCount('close'), holder.listenerCount('error'), holder.stdout.listenerCount('data')], [0, 0, 0], 'the holder keeps no listener of the wait');
});

test('a holder that still holds the lock when a test ends is stopped with the holders (HR-87)', async () => {
  const holder = await holding('node', directory, {});
  assert.equal(holder.exitCode, null);
  assert.equal(running(holder.pid), true, 'the holder waits for a line of its input');
  await stopServers(holders);
  assert.ok(holder.exitCode !== null || holder.signalCode !== null, 'the holder has ended');
  assert.equal(running(holder.pid), false, 'no process of the holder remains');
  assert.deepEqual(holders.filter((child) => child.exitCode === null && child.signalCode === null), [], 'no holder of the file still runs');
});
