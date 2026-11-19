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
    // The event that decides the result is the try of the waiting request to take the lock, which MONITOR shows after
    // the holder took it: the request must not have finished then, because the holder still holds the lock (H35.19-1).
    const monitor = await createClient({ socket: { port: Number(state.port) } }).connect();
    let tried: () => void = () => undefined;
    const triedLock = new Promise<void>((resolve) => (tried = resolve));
    await monitor.monitor((line) => {
      if (commandOf(line) === 'SET' && line.includes(`"${LOCK}"`)) tried();
    });
    let finished = false;
    const waiting = run(name, 'count', '1', name).finally(() => (finished = true));
    await Promise.race([triedLock, waiting]);
    monitor.destroy();
    assert.equal(finished, false, 'the request finished while the other server held the lock');
    holder.stdin.write('\n');
    await waiting;
    assert.deepEqual(JSON.parse(await run('php', 'read', JSON.stringify(['n', 'stale', name]))), [1, 1, 1]);
  });
}

// The Redis store removes ended sessions by the expiry of each key (HY-115.2), so collect of the PHP server under the
// handler redis of phpredis fails and names the handler instead of reading the address as a directory (HY-104.44).
/** Whether a value is the report of the worker command collect: a string handler, and an optional string kind and message. */
function isCollectReport(value: unknown): value is { handler: string; kind?: string; message?: string } {
  if (typeof value !== 'object' || value === null) return false;
  const handler: unknown = Reflect.get(value, 'handler');
  const kind: unknown = Reflect.get(value, 'kind');
  const message: unknown = Reflect.get(value, 'message');
  return typeof handler === 'string' && (kind === undefined || typeof kind === 'string') && (message === undefined || typeof message === 'string');
}

test('collect of the php server under the handler redis fails with invalid_session_handler (HY-104.44)', { timeout: 60_000 }, async () => {
  const result: unknown = JSON.parse(await run('php', 'collect'));
  assert.ok(isCollectReport(result), `collect reports a string handler and an optional kind and message: ${JSON.stringify(result)}`);
  assert.equal(result.handler, 'redis', 'the worker runs under the handler redis of phpredis, which must be loaded');
  assert.equal(result.kind, 'invalid_session_handler', `collect failed with kind invalid_session_handler: ${JSON.stringify(result)}`);
  assert.match(result.message ?? '', /redis/, 'the message names the handler');
});

// phpredis writes nothing for a request that lost its lock and warns. The PHP server closes the session before it
// answers and turns a warning of the close into the failure of the request, so the request fails as in the other
// servers (HY-115.23); tests/scripts/session-lost-lock.test.mts fixes the HTTP answer of the three servers.
test('a request of the php server that lost its lock writes nothing and fails (HY-115)', { timeout: 60_000 }, async () => {
  const holder = await holding('php', state.directory, { HYPER_SESSION_REDIS: state.port });
  await redis.set(LOCK, 'another holder');
  const exit = new Promise<number | null>((resolve) => holder.once('exit', resolve));
  holder.stdin.write('\n');
  assert.notEqual(await exit, 0, 'the request fails');
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
