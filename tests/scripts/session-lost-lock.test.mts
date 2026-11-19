// A request that lost the lock of its session answers status 500 in the PHP, Node and Python servers and writes nothing
// (HY-115.5, HY-115.23): each server closes the session before it answers. A warning that the save handler of PHP raises
// while a session is renewed fails the request whatever error_reporting keeps (HY-115.3).
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createConnection, createServer, type Socket } from 'node:net';
import path from 'node:path';
import { test } from 'node:test';

import { createClient } from 'redis';

import { stopServers } from '../../scripts/board-servers.mts';
import { requireBuilt } from './requires.mts';
import { assertKeepsCookie, cookieOf, post, startBoards, tokenOf } from './session-board.mts';
import { redisRun } from './session-redis-server.mts';
import { run as runWorker } from './session-workers.mts';

const connected = async () => createClient({ socket: { port: Number(state.port) } }).connect();
let redis: Awaited<ReturnType<typeof connected>>;

const state = redisRun(
  'hyper-session-lost-lock-',
  async () => {
    requireBuilt('node-server', 'examples/board/build/node/server.mjs');
    requireBuilt('board', 'examples/board/build/program');
    redis = await connected();
  },
  () => redis.quit(),
);

// A relay between the servers and the Redis server of the run. `arm` names a lock key and resolves when Redis granted
// that lock to a connection; from that reply on, the relay keeps what the server sends on that connection until
// `release`. The test changes the lock between the two, so the order of the events decides the result and no timer does
// (HR-89): the request holds the lock, loses it, and only then reads, writes and closes its session.
interface Gate { port: string; arm(lock: string): Promise<void>; release(): void; close(): Promise<void> }

async function lockGate(redisPort: string): Promise<Gate> {
  const sockets = new Set<Socket>();
  let armed: { lock: string; granted: () => void } | null = null;
  let release: () => void = () => undefined;
  const server = createServer((client) => {
    const upstream = createConnection({ port: Number(redisPort), host: '127.0.0.1' });
    sockets.add(client).add(upstream);
    // Whether the request for the armed lock went to Redis on this connection and its reply has not come back.
    let asked = false;
    // The bytes of the server that wait while the connection is kept, or null while the relay passes them on.
    let kept: Buffer[] | null = null;
    client.on('data', (chunk: Buffer) => {
      if (kept !== null) {
        kept.push(chunk);
        return;
      }
      if (armed !== null && chunk.includes(armed.lock) && chunk.includes('NX')) asked = true;
      upstream.write(chunk);
    });
    upstream.on('data', (chunk: Buffer) => {
      client.write(chunk);
      if (!asked || armed === null) return;
      asked = false;
      // Redis answers a refused `SET NX` with a null, and the server asks again.
      if (!chunk.includes('+OK')) return;
      const waiting: Buffer[] = [];
      kept = waiting;
      release = () => {
        kept = null;
        for (const item of waiting) upstream.write(item);
      };
      const { granted } = armed;
      armed = null;
      granted();
    });
    for (const [socket, other] of [[client, upstream], [upstream, client]] as const) {
      socket.on('error', () => undefined);
      socket.on('close', () => {
        sockets.delete(socket);
        other.destroy();
      });
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address !== null && typeof address !== 'string');
  return {
    port: String(address.port),
    arm: (lock) => new Promise<void>((granted) => {
      armed = { lock, granted };
    }),
    release: () => release(),
    close: async () => {
      const closed = once(server, 'close');
      server.close();
      for (const socket of sockets) socket.destroy();
      await closed;
    },
  };
}

test('a request that lost its lock answers status 500 in the three HTTP servers and writes nothing (HY-115.5, HY-115.23)', { timeout: 300_000 }, async () => {
  const children: Parameters<typeof stopServers>[0] = [];
  const gate = await lockGate(state.port);
  try {
    const env = { BOARD_DB: path.join(state.directory, 'board.sqlite'), BOARD_REDIS: `redis://127.0.0.1:${gate.port}` };
    const boards = await startBoards(children, env, [`session.save_path="tcp://127.0.0.1:${gate.port}"`]);
    const answers: [string, number, string][] = [];
    for (const board of boards) {
      const opened = await fetch(`${board.url}/board/create`);
      assert.equal(opened.status, 200, `${board.name} opens the form`);
      const cookie = cookieOf(opened);
      const token = tokenOf(await opened.text());
      const key = `PHPREDIS_SESSION:${cookie.slice('hy-session='.length)}`;
      const lock = `${key}_LOCK`;
      const record = await redis.get(key);
      assert.ok(record !== null, `${board.name} keeps the session in Redis`);

      // The post writes a flash value, so its request changes the session and compares its lock before it writes.
      const granted = gate.arm(lock);
      const posting = post(board, cookie, token, `lost ${board.name}`);
      await Promise.race([granted, posting.then((early) => assert.fail(`${board.name} answered ${String(early.status)} before Redis granted its lock`))]);
      await redis.set(lock, 'another holder');
      gate.release();
      const response = await posting;

      answers.push([board.name, response.status, await response.text()]);
      assertKeepsCookie(response, board.name);
      assert.equal(await redis.get(key), record, `${board.name} keeps the record of the session`);
      assert.equal(await redis.get(lock), 'another holder', `${board.name} leaves the lock of the other holder`);
    }
    assert.deepEqual(answers, boards.map((board) => [board.name, 500, 'Internal Server Error']));
  } finally {
    await stopServers(children);
    await gate.close();
  }
});

test('a warning while the PHP server renews a session fails the request whatever error_reporting keeps (HY-115.3)', { timeout: 60_000 }, async () => {
  // The worker removes E_USER_WARNING from error_reporting, and its save handler raises one while the old session is
  // removed, as RedisClusterSessions does when the release of its lock fails.
  await assert.rejects(runWorker('php', state.directory, {}, 'renew-warned'), (error: { stdout?: unknown; stderr?: unknown }) => {
    const output = `${String(error.stdout)}${String(error.stderr)}`;
    assert.match(output, /the session could not be renewed: hyper: the session lock was not released/);
    assert.doesNotMatch(output, /^renewed /m, 'the request did not go on');
    return true;
  });
});
