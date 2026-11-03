// The PHP, Node and Python servers share the sessions of one Redis server, with the protocol of phpredis 6.3.0 (HY-115):
// real processes of the three servers, the PHP server through real phpredis, on a real Redis server of the run.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { beforeEach, test } from 'node:test';

import { createClient, RESP_TYPES } from 'redis';

import { EXTENSION, holding, redisRun } from './session-redis-server.mts';
import { CANONICAL, IDENTIFIER, NAMED, NAMES, run as runWorker, VALUES, type Server } from './session-workers.mts';

const KEY = `PHPREDIS_SESSION:${IDENTIFIER}`;
const LOCK = `${KEY}_LOCK`;
const PROCESSES = 3;
const REQUESTS = 200;

const connected = async () => createClient({ socket: { port: Number(state.port) } }).withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer }).connect();
let redis: Awaited<ReturnType<typeof connected>>;

const run = (name: Server, ...args: string[]) => runWorker(name, state.directory, { HYPER_SESSION_REDIS: state.port, PHP_PREFIX: EXTENSION }, ...args);
const text = async (key: string): Promise<string | null> => (await redis.get(key))?.toString('latin1') ?? null;

const state = redisRun(
  'hyper-session-redis-',
  async () => {
    redis = await connected();
  },
  () => redis.quit(),
);

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

// The commands of a line of MONITOR that name the session or its lock: a script runs as one command, and the commands
// inside it are not those of the server. phpredis tries a script by its hash first, which is the same release.
function commandOf(line: string): string | null {
  if (line.includes(' lua] ') || !line.includes(KEY)) return null;
  const name = /\] "([A-Za-z]+)"/.exec(line)?.[1]?.toUpperCase();
  return name === undefined ? null : name;
}

for (const name of NAMES) {
  test(`a request of the ${name} server that changes a session sends the commands of phpredis (HY-115)`, { timeout: 60_000 }, async () => {
    const monitor = await createClient({ socket: { port: Number(state.port) } }).connect();
    const lines: string[] = [];
    await monitor.monitor((line) => lines.push(line));
    await run(name, 'write', '{"x":1}');
    await run(name, 'read', '["x"]');
    await redis.ping();
    monitor.destroy();
    const sent = lines.map(commandOf).filter((command) => command !== null).filter((command, index, all) => !(command === 'EVAL' && all[index - 1] === 'EVALSHA'));
    assert.deepEqual(sent.map((command) => (command === 'EVALSHA' ? 'EVAL' : command)), ['EXISTS', 'SET', 'GET', 'GET', 'SETEX', 'EVAL', 'EXISTS', 'SET', 'GET', 'EXPIRE', 'EVAL']);
  });

  test(`a request of the ${name} server that finds the lock taken fails after its tries and changes nothing (HY-115)`, { timeout: 60_000 }, async () => {
    await redis.set(LOCK, 'another holder');
    await assert.rejects(runWorker(name, state.directory, { HYPER_SESSION_REDIS: state.port, PHP_PREFIX: EXTENSION, HYPER_SESSION_RETRIES: '3' }, 'write', '{"x":1}'));
    assert.equal(await text(KEY), 'a:1:{s:1:"n";i:0;}');
    assert.equal(await text(LOCK), 'another holder');
  });

  test(`the ${name} server waits for the lock that a request of another server holds (HY-115)`, { timeout: 60_000 }, async () => {
    const other = name === 'python' ? 'node' : 'python';
    const holder = await holding(other, state.directory, { HYPER_SESSION_REDIS: state.port });
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
  const holder = await holding('php', state.directory, { HYPER_SESSION_REDIS: state.port });
  await redis.set(LOCK, 'another holder');
  const exit = once(holder, 'exit');
  holder.stdin.write('\n');
  await exit;
  assert.equal(await text(KEY), 'a:1:{s:1:"n";i:0;}', 'the session keeps its record');
  assert.equal(await text(LOCK), 'another holder', 'the lock of the other holder stays');
});

for (const name of ['python', 'node'] as const) {
  test(`a request of the ${name} server that lost its lock writes nothing and fails (HY-115)`, { timeout: 60_000 }, async () => {
    const holder = await holding(name, state.directory, { HYPER_SESSION_REDIS: state.port });
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
