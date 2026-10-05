// Tests the holder lock of `make serve-demo` (scripts/holder-lock.mjs): the demo holds its lock while it runs, a
// second demo fails with the checkout, the process ID and the start time of the first, the demo releases the lock
// when it stops, and a lock of an ended process is reported and stays until `clear` removes it. The demos of the
// test listen on ports that the system assigns.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const repository = resolve('.');
const HOLDER = /held by process (\d+) of the checkout (\S+), started at (\d{4}-\d\d-\d\dT[\d:.]+Z)/;

function workspace(t) {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-serve-demo-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

const demoArgs = (directory) => ['scripts/serve-demo.mjs', '--db', join(directory, 'board.db'), '--ssr', '0', '--edge', '0', '--api', '0', '--lock', join(directory, 'demo.lock')];

// Starts a demo and resolves it once it prints its comparison address.
function startDemo(t, directory) {
  const child = spawn(process.execPath, demoArgs(directory), { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => (child.exitCode === null && child.signalCode === null ? new Promise((done) => { child.once('exit', done); child.kill(); }) : undefined));
  let output = '';
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
  const directory = workspace(t);
  const lock = join(directory, 'demo.lock');
  const first = await startDemo(t, directory);
  const holder = JSON.parse(readFileSync(lock, 'utf8'));
  assert.equal(holder.pid, first.child.pid);
  assert.equal(holder.checkout, repository);
  const second = spawnSync(process.execPath, demoArgs(directory), { encoding: 'utf8' });
  assert.equal(second.status, 1);
  const named = HOLDER.exec(second.stderr);
  assert.ok(named, second.stderr);
  assert.deepEqual([Number(named[1]), named[2], named[3]], [first.child.pid, repository, holder.started]);
  assert.doesNotMatch(second.stdout, /start (api|edge|ssr)/);
  first.child.kill('SIGTERM');
  const code = await new Promise((done) => first.child.once('exit', done));
  assert.equal(code, 0, first.output());
  assert.equal(existsSync(lock), false);
});

test('a lock of an ended demo is reported and stays until clear removes it', { timeout: 20_000 }, (t) => {
  const directory = workspace(t);
  const lock = join(directory, 'demo.lock');
  const ended = Number(spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout);
  writeFileSync(lock, `${JSON.stringify({ checkout: repository, pid: ended, started: '2026-10-05T00:00:00.000Z', token: 'ended' })}\n`);
  const refused = spawnSync(process.execPath, demoArgs(directory), { encoding: 'utf8' });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, new RegExp(`held by process ${ended} of the checkout .*, and that process has ended; remove the lock with`));
  assert.equal(existsSync(lock), true);
  const cleared = spawnSync(process.execPath, ['scripts/holder-lock.mjs', 'clear', lock], { encoding: 'utf8' });
  assert.equal(cleared.status, 0, cleared.stderr);
  assert.equal(existsSync(lock), false);
});

test('clear fails while the demo runs', { timeout: 20_000 }, async (t) => {
  const directory = workspace(t);
  const first = await startDemo(t, directory);
  const refused = spawnSync(process.execPath, ['scripts/holder-lock.mjs', 'clear', join(directory, 'demo.lock')], { encoding: 'utf8' });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, new RegExp(`held by process ${first.child.pid} of the checkout .*, which still runs`));
});
