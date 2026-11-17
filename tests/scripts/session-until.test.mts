// A step of the session tests that waits for a condition ends with the failure of a process that the condition needs
// (HR-84): the wait names the process and its status, and does not last until the time limit of the test runner.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';

import { until } from './session-redis-server.mts';

// The checks that a wait may still make after its process has ended, before this test ends the wait itself: a wait that
// does not watch the process is shown by the end of the wait, not by the time limit of the runner.
const CHECKS_AFTER_EXIT = 3;

for (const [what, script, status] of [['exits with a status', 'process.exit(3)', '3'], ['is ended by a signal', "process.kill(process.pid, 'SIGKILL')", 'SIGKILL']] as const) {
  test(`a wait whose process ${what} fails with the name and the status of that process (HR-84)`, async () => {
    const stub = spawn(process.execPath, ['-e', `process.stdin.once('data', () => { ${script}; })`], { stdio: ['pipe', 'ignore', 'ignore'] });
    let exited = false;
    const exit = once(stub, 'exit').then(() => {
      exited = true;
    });
    let after = 0;
    const waited = until(async () => {
      if (!exited) return false;
      after += 1;
      return after > CHECKS_AFTER_EXIT;
    }, { name: 'the stub server', process: stub });
    stub.stdin.write('\n');
    await assert.rejects(waited, new RegExp(`^Error: the stub server ended with ${status} while a step waited for a condition that needs it$`));
    await exit;
  });
}

test('a wait whose process has already ended fails before it checks the condition (HR-84)', async () => {
  const stub = spawn(process.execPath, ['-e', 'process.exit(4)'], { stdio: 'ignore' });
  await once(stub, 'exit');
  let checks = 0;
  await assert.rejects(until(async () => {
    checks += 1;
    return checks > CHECKS_AFTER_EXIT;
  }, { name: 'the stub server', process: stub }), /^Error: the stub server ended with 4 while a step waited/);
  assert.equal(checks, 0);
});

test('a wait resolves when its condition holds while its processes run, and leaves no listener on them', async () => {
  const stub = spawn(process.execPath, ['-e', "process.stdin.once('data', () => process.exit(0))"], { stdio: ['pipe', 'ignore', 'ignore'] });
  const listeners = stub.listenerCount('exit');
  let checks = 0;
  await until(async () => {
    checks += 1;
    return checks === 2;
  }, { name: 'the stub server', process: stub });
  assert.equal(stub.listenerCount('exit'), listeners);
  const exit = once(stub, 'exit');
  stub.stdin.write('\n');
  await exit;
});
