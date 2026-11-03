// The PHP, Node and Python servers share the sessions of one Redis server, with the protocol of phpredis 6.3.0 (HY-115):
// real processes of the three servers, the PHP server through real phpredis, on a real Redis server of the run.
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';

import { createClient, RESP_TYPES } from 'redis';

import { requireBuilt } from './requires.mts';
import { CANONICAL, COMMANDS, IDENTIFIER, NAMED, NAMES, ROOT, run as runWorker, VALUES, type Server } from './session-workers.mts';

const KEY = `PHPREDIS_SESSION:${IDENTIFIER}`;
const LOCK = `${KEY}_LOCK`;
const PROCESSES = 3;
const REQUESTS = 200;
let server: ChildProcessWithoutNullStreams;
let port = '';
let directory = '';
let extension = '';

const connected = async () => createClient({ socket: { port: Number(port) } }).withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer }).connect();
let redis: Awaited<ReturnType<typeof connected>>;

const run = (name: Server, ...args: string[]) => runWorker(name, directory, { HYPER_SESSION_REDIS: port, PHP_PREFIX: extension }, ...args);
const text = async (key: string): Promise<string | null> => (await redis.get(key))?.toString('latin1') ?? null;

before(async () => {
  requireBuilt('hyper-install-redis', 'var/redis/redis-server', 'var/redis/redis.so');
  requireBuilt('packages', 'packages/server/ts/dist/index.js');
  requireBuilt('hyper-install-python', 'packages/server/python/.venv/bin/python');
  requireBuilt('hyper-install-php', 'vendor/autoload.php');
  extension = `-dextension=${path.join(ROOT, 'var/redis/redis.so')}`;
  directory = mkdtempSync(path.join(tmpdir(), 'hyper-session-redis-'));
  const free = createServer();
  free.listen(0, '127.0.0.1');
  await once(free, 'listening');
  const address = free.address();
  if (address === null || typeof address === 'string') throw new Error('no TCP port is free');
  port = String(address.port);
  free.close();
  await once(free, 'close');
  server = spawn(path.join(ROOT, 'var/redis/redis-server'), ['--port', port, '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no', '--dir', directory]);
  await new Promise<void>((resolve, reject) => {
    server.once('exit', (code) => reject(new Error(`the Redis server ended with ${String(code)}`)));
    let output = '';
    server.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('Ready to accept connections')) resolve();
    });
  });
  redis = await connected();
});

after(async () => {
  await redis.quit();
  server.removeAllListeners('exit');
  server.kill('SIGKILL');
  rmSync(directory, { recursive: true, force: true });
});

beforeEach(async () => {
  await redis.flushAll();
  await redis.set(KEY, 'a:1:{s:1:"n";i:0;}');
});

test('processes of the three servers that write one session at the same time lose no update (HY-115)', { timeout: 120_000 }, async () => {
  await Promise.all(NAMES.flatMap((name) => Array.from({ length: PROCESSES }, () => run(name, 'count', String(REQUESTS), name))));
  const total = PROCESSES * REQUESTS;
  assert.deepEqual(JSON.parse(await run('php', 'read', JSON.stringify(['n', 'php', 'python', 'node']))), [3 * total, total, total, total]);
  assert.equal(await redis.exists(LOCK), 0, 'every server released the lock');
  assert.ok((await redis.ttl(KEY)) > 0, 'the session expires');
});

for (const writer of NAMES) {
  test(`the values that the ${writer} server writes are the same values in every server (HY-115)`, { timeout: 60_000 }, async () => {
    await redis.set(KEY, '');
    await run(writer, 'write', VALUES);
    const record = await text(KEY);
    for (const reader of NAMES) {
      assert.deepEqual(JSON.parse(await run(reader, 'read', JSON.stringify(NAMED))), CANONICAL, `${reader} reads what ${writer} wrote`);
      assert.equal(await text(KEY), record, `${reader} keeps the bytes of a record that it does not change`);
    }
  });
}

// Starts a request of a server that has written a value and waits for a line before it closes.
async function holding(name: Server) {
  const { command, prefix } = COMMANDS[name];
  const holder = spawn(command, [...(name === 'php' ? [extension] : []), ...prefix, directory, IDENTIFIER, 'stale'], { cwd: ROOT, env: { ...process.env, HYPER_SESSION_REDIS: port } });
  await once(holder.stdout, 'data');
  return holder;
}

for (const name of NAMES) {
  test(`a request of the ${name} server that finds the lock taken fails after its tries and changes nothing (HY-115)`, { timeout: 60_000 }, async () => {
    await redis.set(LOCK, 'another holder');
    await assert.rejects(runWorker(name, directory, { HYPER_SESSION_REDIS: port, PHP_PREFIX: extension, HYPER_SESSION_RETRIES: '3' }, 'write', '{"x":1}'));
    assert.equal(await text(KEY), 'a:1:{s:1:"n";i:0;}');
    assert.equal(await text(LOCK), 'another holder');
  });

  test(`the ${name} server waits for the lock that a request of another server holds (HY-115)`, { timeout: 60_000 }, async () => {
    const other = name === 'python' ? 'node' : 'python';
    const holder = await holding(other);
    const waiting = run(name, 'count', '1', name);
    const first = await Promise.race([waiting.then(() => 'finished'), new Promise((resolve) => setTimeout(() => resolve('waiting'), 200))]);
    assert.equal(first, 'waiting');
    holder.stdin.write('\n');
    await waiting;
    assert.deepEqual(JSON.parse(await run('php', 'read', JSON.stringify(['n', 'stale', name]))), [1, 1, 1]);
  });
}

// phpredis writes nothing for a request that lost its lock and warns; PHP closes the session after the response, so the
// request has already answered (HY-115).
test('a request of the php server that lost its lock writes nothing (HY-115)', { timeout: 60_000 }, async () => {
  const holder = await holding('php');
  await redis.set(LOCK, 'another holder');
  const exit = once(holder, 'exit');
  holder.stdin.write('\n');
  await exit;
  assert.equal(await text(KEY), 'a:1:{s:1:"n";i:0;}', 'the session keeps its record');
  assert.equal(await text(LOCK), 'another holder', 'the lock of the other holder stays');
});

for (const name of ['python', 'node'] as const) {
  test(`a request of the ${name} server that lost its lock writes nothing and fails (HY-115)`, { timeout: 60_000 }, async () => {
    const holder = await holding(name);
    await redis.set(LOCK, 'another holder');
    const exit = new Promise<number | null>((resolve) => holder.once('exit', resolve));
    holder.stdin.write('\n');
    assert.notEqual(await exit, 0, 'the request fails');
    assert.equal(await text(KEY), 'a:1:{s:1:"n";i:0;}', 'the session keeps its record');
    assert.equal(await text(LOCK), 'another holder', 'the lock of the other holder stays');
  });

  test(`a renewal of the ${name} server moves the session and PHP reads it (HY-72, HY-115)`, { timeout: 60_000 }, async () => {
    const renewed = (await run(name, 'renew')).trim();
    assert.match(renewed, /^[0-9a-f]{64}$/);
    assert.equal(await redis.exists(KEY), 0, 'the old key is gone');
    assert.equal(await text(`PHPREDIS_SESSION:${renewed}`), 'a:1:{s:1:"n";i:0;}');
    assert.equal(await redis.exists(LOCK), 0);
  });

  test(`an identifier without a key names no session in the ${name} server and leaves no key (HY-45, HY-115)`, { timeout: 60_000 }, async () => {
    await redis.flushAll();
    assert.deepEqual(JSON.parse(await run(name, 'read', JSON.stringify(['n']))), [null]);
    const keys = await redis.keys('*');
    assert.deepEqual(keys.filter((key) => key.toString().endsWith('_LOCK') || key.toString() === KEY), []);
  });
}
