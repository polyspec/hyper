// A step of the session tests that waits for a line ends with the failure of the process that writes it (HR-84): the wait
// names the process and its status, and does not last until the time limit of the test runner.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';

import { linesOf, readLines } from './session-redis-server.mts';

for (const [what, script, status] of [
  ['exits with a status', 'process.exit(3)', '3'],
  ['is ended by a signal', "process.kill(process.pid, 'SIGKILL')", 'SIGKILL'],
] as const) {
  test(`a wait for a line whose process ${what} fails with the name and the status of that process (HR-84)`, async () => {
    const stub = spawn(process.execPath, ['-e', `process.stdin.once('data', () => { ${script}; })`], { stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = readLines('the stub server', stub);
    const exit = once(stub, 'exit');
    const waited = linesOf(stub).until(0, (line) => line === 'never', 'the stub line');
    stub.stdin.write('\n');
    await assert.rejects(waited, new RegExp(`^Error: the stub server: the stub line: it ended with ${status === 'SIGKILL' ? 'SIGKILL' : status} before the line`));
    await exit;
    assert.equal(lines.length, 0);
  });
}

test('a wait for a line whose process has already ended fails at once (HR-84)', async () => {
  const stub = spawn(process.execPath, ['-e', 'process.exit(4)'], { stdio: ['ignore', 'pipe', 'ignore'] });
  readLines('the stub server', stub);
  await once(stub, 'exit');
  await assert.rejects(linesOf(stub).until(0, () => true, 'the stub line'), /^Error: the stub server: the stub line: it ended with 4 before the line/);
});

test('a wait for a line resolves with its index when the line is written, and leaves no listener on the process', async () => {
  const stub = spawn(process.execPath, ['-e', "process.stdin.once('data', () => { console.log('READY'); process.exit(0); })"], { stdio: ['pipe', 'pipe', 'ignore'] });
  readLines('the stub server', stub);
  const exit = once(stub, 'exit');
  const index = await linesOf(stub).until(0, (line) => line === 'READY', 'the stub line');
  assert.equal(index, 0);
  stub.stdin.write('\n');
  await exit;
});
