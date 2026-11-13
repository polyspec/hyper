// The Redis sessions under failure and through the HTTP servers (HY-115): a lock that really expires, a process killed while
// it holds the lock, requests of the PHP, Node and Python servers that share one session by its cookie, and a stop and a
// start of the Redis server.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import path from 'node:path';
import { beforeEach, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { createClient } from 'redis';

import { stopServers } from '../../scripts/board-servers.mts';
import { requireBuilt } from './requires.mts';
import { assertKeepsCookie, post, shareAcross, startBoards } from './session-board.mts';
import { EXTENSION, holding, redisRun, startRedis, stopRedis } from './session-redis-server.mts';
import { IDENTIFIER, NAMES, run as runWorker, type Server } from './session-workers.mts';

const KEY = `PHPREDIS_SESSION:${IDENTIFIER}`;
const LOCK = `${KEY}_LOCK`;
const RECORD = 'a:1:{s:1:"n";i:0;}';
const EXPIRE = '1';

const connected = async () => createClient({ socket: { port: Number(state.port) }, disableOfflineQueue: true }).on('error', (error: unknown) => {
  process.stderr.write(`the Redis client of the test: ${String(error)}\n`);
}).connect();
let redis: Awaited<ReturnType<typeof connected>>;

const environment = () => ({ HYPER_SESSION_REDIS: state.port, PHP_PREFIX: EXTENSION });
const read = async (): Promise<unknown> => JSON.parse(await runWorker('php', state.directory, environment(), 'read', JSON.stringify(['n', 'stale', 'x'])));

const state = redisRun(
  'hyper-session-failure-',
  async () => {
    requireBuilt('node-server', 'examples/board/build/node/server.mjs');
    requireBuilt('board', 'examples/board/build/program');
    redis = await connected();
  },
  () => redis.quit(),
);

beforeEach(async () => {
  await redis.flushAll();
  await redis.set(KEY, RECORD);
});

for (const [index, name] of NAMES.entries()) {
  const other: Server = NAMES[(index + 1) % NAMES.length] ?? 'php';

  test(`a request of the ${name} server whose lock really expired does not overwrite the request of the ${other} server that took it (HY-115)`, { timeout: 60_000 }, async () => {
    const holder = await holding(name, state.directory, { HYPER_SESSION_REDIS: state.port, HYPER_SESSION_EXPIRE: EXPIRE });
    while ((await redis.exists(LOCK)) === 1) await delay(50);
    await runWorker(other, state.directory, environment(), 'write', '{"x":1}');
    const exit = once(holder, 'exit');
    holder.stdin.write('\n');
    await exit;
    assert.deepEqual(await read(), [0, null, 1]);
    assert.equal(await redis.exists(LOCK), 0, 'the lock of the later request is gone and the holder released no other lock');
  });

  test(`the ${other} server goes on after a process of the ${name} server is killed while it holds the lock (HY-115)`, { timeout: 60_000 }, async () => {
    const holder = await holding(name, state.directory, { HYPER_SESSION_REDIS: state.port, HYPER_SESSION_EXPIRE: '5' });
    const exit = once(holder, 'exit');
    holder.kill('SIGKILL');
    await exit;
    assert.equal(await redis.exists(LOCK), 1, 'the lock outlives the process until it expires');
    await runWorker(other, state.directory, environment(), 'write', '{"x":1}');
    assert.deepEqual(await read(), [0, null, 1], 'the killed request wrote nothing and the next request wrote its value');
    assert.equal(await redis.exists(LOCK), 0);
  });
}

test('the three HTTP servers share a session by its cookie, answer status 500 while Redis is stopped and go on with the session after it starts (HY-115)', { timeout: 300_000 }, async () => {
  const children: Parameters<typeof stopServers>[0] = [];
  const url = `redis://127.0.0.1:${state.port}`;
  const env = { BOARD_DB: path.join(state.directory, 'board.sqlite') };
  try {
    const boards = await startBoards(children, { ...env, BOARD_REDIS: url }, [`session.save_path="tcp://127.0.0.1:${state.port}?persistent=1"`]);
    const sessions = await shareAcross(boards);
    for (const { cookie } of sessions) assert.equal(await redis.exists(`PHPREDIS_SESSION:${cookie.slice('hy-session='.length)}`), 1, 'the servers keep the session in Redis');

    await redis.disconnect();
    assert.ok(state.server !== null);
    await stopRedis(state.server, 'SIGTERM');
    const [session] = sessions;
    assert.ok(session !== undefined);
    for (const board of boards) {
      const response: Response = await fetch(`${board.url}/board/create`, { headers: { cookie: session.cookie } });
      assert.equal(response.status, 500, `${board.name} answers 500 without Redis`);
      assert.equal(await response.text(), 'Internal Server Error', `${board.name} tells no detail`);
      assertKeepsCookie(response, board.name);
      const anonymous: Response = await fetch(`${board.url}/board/create`);
      assert.equal(anonymous.status, 500, `${board.name} answers 500 to a new client without Redis`);
      assertKeepsCookie(anonymous, `${board.name} to a new client`);
    }

    state.server = await startRedis(state.directory, state.port);
    redis = await connected();
    for (const board of boards) {
      let response: Response = await post(board, session.cookie, session.token, `after ${board.name}`);
      while (response.status === 500) {
        await delay(100);
        response = await post(board, session.cookie, session.token, `after ${board.name}`);
      }
      assert.equal(response.status, 303, `${board.name} goes on with the session after the start of Redis`);
    }
  } finally {
    await stopServers(children);
  }
});

test('a process of the PHP server with a persistent connection runs its requests on one connection and releases each lock (HY-115)', { timeout: 60_000 }, async () => {
  const connections = async (): Promise<number> => Number(/total_connections_received:(\d+)/.exec(await redis.info('stats'))?.[1]);
  const before = await connections();
  await runWorker('php', state.directory, { ...environment(), HYPER_SESSION_PERSISTENT: '1' }, 'count', '100', 'php');
  assert.equal(await connections() - before, 1, 'the requests share one connection');
  assert.deepEqual(JSON.parse(await runWorker('php', state.directory, environment(), 'read', '["n","php"]')), [100, 100]);
  assert.equal(await redis.exists(LOCK), 0);
});

test('a persistent connection of the PHP server authenticates again on each reuse, so a changed password fails while the connection stays open (HY-115)', { timeout: 120_000 }, async () => {
  await redis.sendCommand(['ACL', 'SETUSER', 'hyper', 'on', '>before', '~*', '&*', '+@all']);
  try {
    const env = { ...environment(), HYPER_SESSION_PERSISTENT: '1', HYPER_SESSION_RETRIES: '5', HYPER_SESSION_USER: 'hyper', HYPER_SESSION_PASSWORD: 'before' };
    const writer = runWorker('php', state.directory, env, 'count', '10000000', 'php');
    const failed = assert.rejects(writer, 'the process fails once its password is refused');
    for (;;) {
      if (Number(/"n";i:(\d+);/.exec(String(await redis.get(KEY)))?.[1] ?? 0) >= 5) break;
      await delay(20);
    }
    // Changing a password keeps the open connections of Redis, so only a new AUTH can notice it.
    await redis.sendCommand(['ACL', 'SETUSER', 'hyper', 'resetpass', '>after']);
    await failed;
  } finally {
    await redis.sendCommand(['ACL', 'DELUSER', 'hyper']);
  }
});
