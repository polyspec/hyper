// The Redis sessions under failure and through the HTTP servers (HY-115): a lock that really expires, a process killed while
// it holds the lock, requests of the PHP, Node and Python servers that share one session by its cookie, and a stop and a
// start of the Redis server.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import path from 'node:path';
import { beforeEach, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { createClient } from 'redis';

import { startNode, startPhp, startPython, stopServers, type Server as Started } from '../../scripts/board-servers.mts';
import { requireBuilt } from './requires.mts';
import { EXTENSION, holding, redisRun, startRedis, stopRedis } from './session-redis-server.mts';
import { IDENTIFIER, NAMES, ROOT, run as runWorker, type Server } from './session-workers.mts';

const KEY = `PHPREDIS_SESSION:${IDENTIFIER}`;
const LOCK = `${KEY}_LOCK`;
const RECORD = 'a:1:{s:1:"n";i:0;}';
const BOARD = path.join(ROOT, 'examples/board');
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
    requireBuilt('server', 'examples/board/build/server');
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

// One server of the board and its address.
interface Board { name: string; url: string }
const cookieOf = (response: Response): string => {
  const cookie = response.headers.getSetCookie().find((line) => line.startsWith('hy-session='));
  assert.notEqual(cookie, undefined, 'the response sets the session cookie');
  return String(cookie).split(';')[0] ?? '';
};
const tokenOf = (body: string): string => {
  const token = /name="_csrf" value="([^"]+)"/.exec(body)?.[1];
  assert.notEqual(token, undefined, 'the form holds the CSRF token');
  return String(token);
};
const post = (board: Board, cookie: string, token: string, title: string): Promise<Response> => fetch(`${board.url}/board/create`, {
  method: 'POST',
  redirect: 'manual',
  headers: { cookie, origin: board.url, 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ _csrf: token, title, author: board.name, body: 'text' }),
});

test('the three HTTP servers share a session by its cookie, answer status 500 while Redis is stopped and go on with the session after it starts (HY-115)', { timeout: 300_000 }, async () => {
  const children: Parameters<typeof stopServers>[0] = [];
  const url = `redis://127.0.0.1:${state.port}`;
  const env = { BOARD_DB: path.join(state.directory, 'board.sqlite') };
  try {
    const started: [string, Started][] = [
      ['php', await startPhp({ name: 'php', app: BOARD, port: 0, env, ini: [`extension=${path.join(ROOT, 'var/redis/redis.so')}`, 'session.save_handler=redis', `session.save_path=tcp://127.0.0.1:${state.port}`, 'redis.session.locking_enabled=1', 'redis.session.lock_expire=30'], children })],
      ['node', await startNode({ name: 'node', app: BOARD, port: 0, env: { ...env, BOARD_REDIS: url }, children })],
      ['python', await startPython({ name: 'python', app: BOARD, port: 0, env: { ...env, BOARD_REDIS: url }, children })],
    ];
    const boards: Board[] = started.map(([name, { url: address }]) => ({ name, url: address }));
    const sessions: { cookie: string; token: string }[] = [];
    for (const [index, first] of boards.entries()) {
      for (const offset of [1, 2]) {
        const second = boards[(index + offset) % boards.length];
        const third = boards[(index + 3 - offset) % boards.length];
        assert.ok(second !== undefined && third !== undefined);
        const opened = await fetch(`${first.url}/board/create`);
        assert.equal(opened.status, 200, `${first.name} opens the form`);
        const cookie = cookieOf(opened);
        const token = tokenOf(await opened.text());
        assert.equal(await redis.exists(`PHPREDIS_SESSION:${cookie.slice('hy-session='.length)}`), 1, `${first.name} keeps the session in Redis`);
        const posted = await post(second, cookie, token, `${first.name} ${second.name}`);
        assert.equal(posted.status, 303, `${second.name} accepts the token that ${first.name} issued`);
        const page = await (await fetch(`${third.url}/board`, { headers: { cookie } })).text();
        const later = await (await fetch(`${third.url}/board`, { headers: { cookie } })).text();
        assert.match(page, /class="new"/, `${third.name} reads the flash value that ${second.name} wrote`);
        assert.doesNotMatch(later, /class="new"/, `${third.name} took the flash value once`);
        sessions.push({ cookie, token });
      }
    }

    await redis.disconnect();
    assert.ok(state.server !== null);
    await stopRedis(state.server, 'SIGTERM');
    const [session] = sessions;
    assert.ok(session !== undefined);
    for (const board of boards) {
      const response: Response = await fetch(`${board.url}/board/create`, { headers: { cookie: session.cookie } });
      assert.equal(response.status, 500, `${board.name} answers 500 without Redis`);
      assert.equal(await response.text(), 'Internal Server Error', `${board.name} tells no detail`);
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
