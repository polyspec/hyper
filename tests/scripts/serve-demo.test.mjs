// Tests the holder lock of `make serve-demo` (scripts/kit/holder-lock.mjs): the demo holds its lock while it runs, a
// second demo fails with the checkout, the process ID and the start time of the first, and the demo releases the lock
// when it stops. The rules of the lock itself are tested in tests/kit/holder-lock.test.mjs. The demos of the
// test listen on ports that the system assigns.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const repository = resolve('.');
const HOLDER = /held by process (\d+) \(started ([^)]+)\) of the checkout (\S+), held since/;

// A temporary directory with the demos of a test. One hook ends every demo that still runs, waits for its exit and
// checks that it released its lock, and only then removes the directory, which holds the lock and the database of the
// demos (HY-87); node:test runs the hooks of a test in the order of their registration.
function workspace(t) {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-serve-demo-'));
  const demos = [];
  t.after(async () => {
    for (const demo of demos) {
      if (demo.child.exitCode === null && demo.child.signalCode === null) {
        await new Promise((done) => { demo.child.once('exit', done); demo.child.kill(); });
      }
      assert.doesNotMatch(demo.output(), /ENOENT/, 'the directory of the demo was removed before the demo stopped');
    }
    rmSync(directory, { recursive: true, force: true });
  });
  return { directory, demos };
}

const demoArgs = (directory) => ['scripts/serve-demo.mjs', '--db', join(directory, 'board.db'), '--ssr', '0', '--edge', '0', '--api', '0', '--lock', join(directory, 'demo.lock')];

// Starts a demo in a workspace and resolves it once it prints its comparison address.
function startDemo({ directory, demos }) {
  const child = spawn(process.execPath, demoArgs(directory), { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  demos.push({ child, output: () => output });
  child.stderr.on('data', (data) => { output += data; });
  return new Promise((resolvePromise, reject) => {
    child.stdout.on('data', (data) => {
      output += data;
      if (/^compare http:\/\/127\.0\.0\.1:\d+\/compare\?ssr=http:\/\/127\.0\.0\.1:\d+$/m.test(output)) resolvePromise({ child, output: () => output });
    });
    child.once('exit', (code) => reject(new Error(`the demo exited with ${code}:\n${output}`)));
  });
}

test('a second demo fails with the holder, and the first releases the lock when it stops', { timeout: 20_000 }, async (t) => {
  const space = workspace(t);
  const { directory } = space;
  const lock = join(directory, 'demo.lock');
  const first = await startDemo(space);
  const holder = JSON.parse(readFileSync(lock, 'utf8'));
  assert.equal(holder.pid, first.child.pid);
  assert.equal(holder.checkout, repository);
  const second = spawnSync(process.execPath, demoArgs(directory), { encoding: 'utf8' });
  assert.equal(second.status, 1);
  const named = HOLDER.exec(second.stderr);
  assert.ok(named, second.stderr);
  assert.deepEqual([Number(named[1]), named[2], named[3]], [first.child.pid, holder.processStart, repository]);
  assert.doesNotMatch(second.stdout, /start (api|edge|ssr)/);
  first.child.kill('SIGTERM');
  const code = await new Promise((done) => first.child.once('exit', done));
  assert.equal(code, 0, first.output());
  assert.equal(existsSync(lock), false);
});
