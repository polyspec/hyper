// The Redis sessions on a real Redis Cluster of three primaries (HY-115): the PHP server through RedisClusterSessions and real
// phpredis, the Node and Python servers through cluster clients: slots that move while the servers write, the failures of a lock,
// a renewal, the HTTP servers of the board, a replica that takes over, TLS and an ACL user.
import assert from 'node:assert/strict';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { stopServers } from '../../scripts/board-servers.mts';
import { requireServers, shareAcross, startBoards } from './session-board.mts';
import { ask, certificates, EXTENSION, freePort, holding, startRedis, stopRedis, until, type Secure } from './session-redis-server.mts';
import { IDENTIFIER, NAMES, run as runWorker, type Server } from './session-workers.mts';

const KEY = `PHPREDIS_SESSION:${IDENTIFIER}`;
const LOCK = `${KEY}_LOCK`;
const RECORD = 'a:1:{s:1:"n";i:0;}';
const SLOTS = 16384;
const PRIMARIES = 3;
let directory = '';
const processes: Parameters<typeof stopServers>[0] = [];

interface Node { port: string; bus: string; server: ChildProcessWithoutNullStreams }

// A cluster of the run, of three primaries that share the slots.
class Cluster {
  readonly nodes: Node[] = [];
  private readonly prefix: string;
  private readonly secure: Secure | undefined;

  constructor(prefix: string, secure?: Secure) {
    this.prefix = prefix;
    this.secure = secure;
  }

  get ports(): string[] {
    return this.nodes.map((node) => node.port);
  }

  ask(port: string, ...words: string[]): Promise<unknown> {
    return ask(port, this.secure, ...words);
  }

  // Starts one node. Its bus has a port of its own, because the default, the port plus 10000, is out of range for a port that the
  // system assigned.
  async startNode(name: string): Promise<Node> {
    const own = path.join(directory, `${this.prefix}-${name}`);
    mkdirSync(own, { recursive: true });
    const port = await freePort();
    const bus = await freePort();
    const cluster = ['--cluster-enabled', 'yes', '--cluster-port', bus, '--cluster-config-file', 'nodes.conf', '--cluster-node-timeout', '1000'];
    let settings = ['--port', port, ...cluster];
    if (this.secure !== undefined) {
      const { certificate, key, ca, password } = this.secure;
      const file = path.join(own, 'redis.conf');
      writeFileSync(file, ['user default off', `user hyper on >${password} ~* &* +@all`, ''].join('\n'));
      settings = [file, '--port', '0', '--tls-port', port, '--tls-cluster', 'yes', '--tls-replication', 'yes', '--tls-cert-file', certificate, '--tls-key-file', key, '--tls-ca-cert-file', ca, '--tls-auth-clients', 'no', '--masteruser', 'hyper', '--masterauth', password, ...cluster];
    }
    const server = await startRedis(own, port, settings);
    processes.push(server);
    return { port, bus, server };
  }

  // Starts the primaries, gives each its slots, and resolves when each node sees all of them.
  async start(): Promise<void> {
    for (let index = 0; index < PRIMARIES; index += 1) this.nodes.push(await this.startNode(String(index)));
    const size = Math.floor(SLOTS / PRIMARIES);
    for (const [index, node] of this.nodes.entries()) {
      await this.ask(node.port, 'CLUSTER', 'ADDSLOTSRANGE', String(index * size), String(index === PRIMARIES - 1 ? SLOTS - 1 : (index + 1) * size - 1));
    }
    const [first] = this.nodes;
    assert.ok(first !== undefined);
    for (const node of this.nodes.slice(1)) await this.ask(first.port, 'CLUSTER', 'MEET', '127.0.0.1', node.port, node.bus);
    for (const node of this.nodes) {
      await until(async () => {
        const info = String(await this.ask(node.port, 'CLUSTER', 'INFO'));
        return info.includes('cluster_state:ok') && info.includes(`cluster_known_nodes:${String(PRIMARIES)}`);
      });
    }
  }

  // Returns the port of the primary that owns the slot of a key, as a node that answers states it.
  async ownerOf(key: string): Promise<string> {
    const [port] = this.liveports();
    const slot = Number(await this.ask(port ?? '', 'CLUSTER', 'KEYSLOT', key));
    const ranges = await this.ask(port ?? '', 'CLUSTER', 'SLOTS');
    assert.ok(Array.isArray(ranges));
    for (const range of ranges) {
      if (Array.isArray(range) && Number(range[0]) <= slot && slot <= Number(range[1]) && Array.isArray(range[2])) return String(range[2][1]);
    }
    throw new Error(`no node owns the slot of ${key}`);
  }

  liveports(): string[] {
    return this.nodes.filter((node) => node.server.exitCode === null && node.server.signalCode === null).map((node) => node.port);
  }

  // Moves the slot of a key to another primary as a resharding does, and resolves when the nodes name the new owner.
  async moveSlot(key: string): Promise<void> {
    const source = await this.ownerOf(key);
    const target = this.ports.find((port) => port !== source) ?? '';
    const slot = String(await this.ask(source, 'CLUSTER', 'KEYSLOT', key));
    const sourceId = String(await this.ask(source, 'CLUSTER', 'MYID'));
    const targetId = String(await this.ask(target, 'CLUSTER', 'MYID'));
    await this.ask(target, 'CLUSTER', 'SETSLOT', slot, 'IMPORTING', sourceId);
    await this.ask(source, 'CLUSTER', 'SETSLOT', slot, 'MIGRATING', targetId);
    for (;;) {
      const keys = await this.ask(source, 'CLUSTER', 'GETKEYSINSLOT', slot, '100');
      assert.ok(Array.isArray(keys));
      if (keys.length === 0) break;
      await delay(20);
      await this.ask(source, 'MIGRATE', '127.0.0.1', target, '', '0', '5000', 'KEYS', ...keys.map(String));
    }
    for (const port of [target, source, ...this.ports.filter((item) => item !== source && item !== target)]) {
      await this.ask(port, 'CLUSTER', 'SETSLOT', slot, 'NODE', targetId);
    }
    await until(async () => (await this.ownerOf(key)) === target);
  }
}

let cluster: Cluster;
const environment = (): Record<string, string> => ({ HYPER_SESSION_CLUSTER: cluster.ports.join(','), PHP_PREFIX: EXTENSION });
const read = async (env: Record<string, string>, names: string[]): Promise<unknown> => JSON.parse(await runWorker('php', directory, env, 'read', JSON.stringify(names)));

before(async () => {
  requireServers();
  directory = mkdtempSync(path.join(tmpdir(), 'hyper-session-cluster-'));
  cluster = new Cluster('main');
  await cluster.start();
});

after(async () => {
  await stopServers(processes);
  rmSync(directory, { recursive: true, force: true });
});

// Stores the first record of the session on the primary that owns its key, and removes a lock of an earlier test.
beforeEach(async () => {
  await cluster.ask(await cluster.ownerOf(KEY), 'SET', KEY, RECORD);
  await cluster.ask(await cluster.ownerOf(LOCK), 'DEL', LOCK);
});

test('the session and its lock live on different primaries, so the commands of a request reach more than one node (HY-115)', { timeout: 60_000 }, async () => {
  assert.notEqual(await cluster.ownerOf(KEY), await cluster.ownerOf(LOCK));
});

test('processes of the three servers lose no update of one session on a cluster (HY-115)', { timeout: 120_000 }, async () => {
  const env = environment();
  await Promise.all(NAMES.map((name) => runWorker(name, directory, env, 'count', '500', name)));
  assert.deepEqual(await read(env, ['n', 'php', 'python', 'node']), [1500, 500, 500, 500]);
  assert.equal(await cluster.ask(await cluster.ownerOf(LOCK), 'EXISTS', LOCK), 0, 'the last request released the lock');
});

test('a value that one server writes is read by the others on a cluster (HY-115)', { timeout: 60_000 }, async () => {
  const env = environment();
  for (const [index, name] of NAMES.entries()) await runWorker(name, directory, env, 'write', JSON.stringify({ [`from_${name}`]: index }));
  const names = JSON.stringify(NAMES.map((name) => `from_${name}`));
  for (const name of NAMES) assert.deepEqual(JSON.parse(await runWorker(name, directory, env, 'read', names)), [0, 1, 2], `${name} reads every value`);
});

for (const [what, key] of [['session', KEY], ['lock', LOCK]] as const) {
  test(`processes of the three servers lose no update while the slot of the ${what} moves (HY-115)`, { timeout: 180_000 }, async () => {
    const env = environment();
    const owner = await cluster.ownerOf(key);
    let finished = 0;
    const writers = NAMES.map((name) => runWorker(name, directory, env, 'count', '3000', name).finally(() => {
      finished += 1;
    }));
    await delay(200);
    await cluster.moveSlot(key);
    assert.equal(finished, 0, 'the writers still ran when the slot had moved');
    assert.notEqual(await cluster.ownerOf(key), owner);
    await Promise.all(writers);
    assert.deepEqual(await read(env, ['n', 'php', 'python', 'node']), [9000, 3000, 3000, 3000]);
  });
}

for (const [index, name] of NAMES.entries()) {
  const other: Server = NAMES[(index + 1) % NAMES.length] ?? 'php';

  test(`a request of the ${name} server whose lock really expired does not overwrite the request of the ${other} server on a cluster (HY-115)`, { timeout: 60_000 }, async () => {
    const env = environment();
    const lockOwner = await cluster.ownerOf(LOCK);
    const holder = await holding(name, directory, { ...env, HYPER_SESSION_EXPIRE: '1' });
    await until(async () => (await cluster.ask(lockOwner, 'EXISTS', LOCK)) === 0);
    await runWorker(other, directory, env, 'write', '{"x":1}');
    const exit = once(holder, 'exit');
    holder.stdin.write('\n');
    await exit;
    assert.deepEqual(await read(env, ['n', 'stale', 'x']), [0, null, 1]);
    assert.equal(await cluster.ask(lockOwner, 'EXISTS', LOCK), 0, 'the holder released no lock of another request');
  });

  test(`the ${other} server goes on after a process of the ${name} server is killed while it holds the lock on a cluster (HY-115)`, { timeout: 60_000 }, async () => {
    const env = environment();
    const holder = await holding(name, directory, { ...env, HYPER_SESSION_EXPIRE: '2' });
    const exit = once(holder, 'exit');
    holder.kill('SIGKILL');
    await exit;
    assert.equal(await cluster.ask(await cluster.ownerOf(LOCK), 'EXISTS', LOCK), 1, 'the lock outlives the process until it expires');
    await runWorker(other, directory, env, 'write', '{"x":1}');
    assert.deepEqual(await read(env, ['n', 'stale', 'x']), [0, null, 1]);
  });
}

test('a request of the PHP server whose lock expired leaves the lock of the next request on a cluster (HY-115)', { timeout: 60_000 }, async () => {
  const env = environment();
  const lockOwner = await cluster.ownerOf(LOCK);
  const expired = await holding('php', directory, { ...env, HYPER_SESSION_EXPIRE: '1' }, 'hold');
  await until(async () => (await cluster.ask(lockOwner, 'EXISTS', LOCK)) === 0);
  const next = await holding('node', directory, env);
  const ended = once(expired, 'exit');
  expired.stdin.write('\n');
  await ended;
  assert.equal(await cluster.ask(lockOwner, 'EXISTS', LOCK), 1, 'the lock of the next request stays');
  const exit = once(next, 'exit');
  next.stdin.write('\n');
  await exit;
  assert.equal(await cluster.ask(lockOwner, 'EXISTS', LOCK), 0);
});

test('a request of the PHP server fails when another holds the lock longer than its tries on a cluster (HY-115)', { timeout: 60_000 }, async () => {
  const env = environment();
  const holder = await holding('node', directory, env);
  try {
    await assert.rejects(runWorker('php', directory, { ...env, HYPER_SESSION_RETRIES: '2' }, 'write', '{"x":1}'));
  } finally {
    const exit = once(holder, 'exit');
    holder.stdin.write('\n');
    await exit;
  }
  assert.deepEqual(await read(env, ['x']), [null]);
});

test('the PHP server on a cluster does not take an identifier that no session holds, in strict mode (HY-115)', { timeout: 60_000 }, async () => {
  const env = environment();
  await cluster.ask(await cluster.ownerOf(KEY), 'DEL', KEY);
  await runWorker('php', directory, env, 'write', '{"x":1}');
  assert.equal(await cluster.ask(await cluster.ownerOf(KEY), 'EXISTS', KEY), 0, 'the forged identifier stays without a session');
});

test('a renewal on a cluster keeps the values under the new identifier and removes the old key and the lock (HY-115)', { timeout: 60_000 }, async () => {
  const env = environment();
  const renewed = (await runWorker('php', directory, env, 'renew')).trim();
  assert.notEqual(renewed, IDENTIFIER);
  const key = `PHPREDIS_SESSION:${renewed}`;
  assert.equal(await cluster.ask(await cluster.ownerOf(KEY), 'EXISTS', KEY), 0, 'the old key is gone');
  assert.match(String(await cluster.ask(await cluster.ownerOf(key), 'GET', key)), /"renewed";i:1;/);
  for (const lock of [LOCK, `${key}_LOCK`]) assert.equal(await cluster.ask(await cluster.ownerOf(lock), 'EXISTS', lock), 0, `${lock} is released`);
  await cluster.ask(await cluster.ownerOf(key), 'DEL', key);
  for (const name of ['python', 'node'] satisfies Server[]) {
    await cluster.ask(await cluster.ownerOf(KEY), 'SET', KEY, RECORD);
    await runWorker(name, directory, env, 'renew');
    assert.equal(await cluster.ask(await cluster.ownerOf(KEY), 'EXISTS', KEY), 0, `${name} removed the old key`);
    assert.equal(await cluster.ask(await cluster.ownerOf(LOCK), 'EXISTS', LOCK), 0, `${name} released the lock`);
  }
});

for (const name of NAMES) {
  test(`a request of the ${name} server that changes nothing sets a new expiry on a cluster (HY-115)`, { timeout: 60_000 }, async () => {
    const owner = await cluster.ownerOf(KEY);
    await cluster.ask(owner, 'EXPIRE', KEY, '100');
    await runWorker(name, directory, environment(), 'read', '["n"]');
    assert.ok(Number(await cluster.ask(owner, 'TTL', KEY)) > 100);
    assert.equal(await cluster.ask(owner, 'GET', KEY), RECORD, 'the record keeps its bytes');
  });
}

test('the three HTTP servers share a session by its cookie on a cluster (HY-115)', { timeout: 120_000 }, async () => {
  const children: Parameters<typeof stopServers>[0] = [];
  try {
    const boards = await startBoards(children, { BOARD_DB: path.join(directory, 'cluster.sqlite'), BOARD_CLUSTER: cluster.ports.map((port) => `127.0.0.1:${port}`).join(',') }, []);
    const sessions = await shareAcross(boards);
    for (const { cookie } of sessions) {
      const key = `PHPREDIS_SESSION:${cookie.slice('hy-session='.length)}`;
      assert.equal(await cluster.ask(await cluster.ownerOf(key), 'EXISTS', key), 1, 'the servers keep the session on the cluster');
    }
  } finally {
    await stopServers(children);
  }
});

test('the three servers share a session over TLS with an ACL user on a cluster (HY-115)', { timeout: 120_000 }, async () => {
  const secure = certificates(directory);
  const safe = new Cluster('secure', secure);
  await safe.start();
  const env = { HYPER_SESSION_CLUSTER: safe.ports.join(','), HYPER_SESSION_TLS_CA: secure.ca, HYPER_SESSION_USER: 'hyper', HYPER_SESSION_PASSWORD: secure.password, PHP_PREFIX: EXTENSION };
  await safe.ask(await safe.ownerOf(KEY), 'SET', KEY, RECORD);
  await Promise.all(NAMES.map((name) => runWorker(name, directory, env, 'count', '50', name)));
  assert.deepEqual(await read(env, ['n', 'php', 'python', 'node']), [150, 50, 50, 50]);
  for (const name of NAMES) {
    await assert.rejects(runWorker(name, directory, { ...env, HYPER_SESSION_PASSWORD: 'wrong' }, 'write', '{"x":1}'), `${name} is refused with a wrong password`);
  }
});

// The last test, because it ends a primary of the cluster.
test('a replica takes over a primary that dies and the three servers go on with the session (HY-115)', { timeout: 180_000 }, async () => {
  const env = environment();
  const ownerPort = await cluster.ownerOf(KEY);
  const owner = cluster.nodes.find((node) => node.port === ownerPort);
  assert.ok(owner !== undefined);
  const replica = await cluster.startNode('replica');
  await cluster.ask(ownerPort, 'CLUSTER', 'MEET', '127.0.0.1', replica.port, replica.bus);
  const ownerId = String(await cluster.ask(ownerPort, 'CLUSTER', 'MYID'));
  await until(async () => String(await cluster.ask(replica.port, 'CLUSTER', 'NODES')).includes(ownerId));
  await cluster.ask(replica.port, 'CLUSTER', 'REPLICATE', ownerId);
  await until(async () => String(await cluster.ask(replica.port, 'INFO', 'replication')).includes('master_link_status:up'));
  for (const name of NAMES) await runWorker(name, directory, env, 'write', JSON.stringify({ [`before_${name}`]: 1 }));
  assert.equal(await cluster.ask(ownerPort, 'WAIT', '1', '10000'), 1, 'the replica acknowledged');
  await stopRedis(owner.server, 'SIGKILL');
  cluster.nodes.splice(cluster.nodes.indexOf(owner), 1, replica);
  await until(async () => String(await cluster.ask(replica.port, 'CLUSTER', 'INFO')).includes('cluster_state:ok') && String(await cluster.ask(replica.port, 'INFO', 'replication')).includes('role:master'));
  const after_ = { ...env, HYPER_SESSION_CLUSTER: [ownerPort, ...cluster.ports].join(',') };
  const names = JSON.stringify(NAMES.map((name) => `before_${name}`));
  for (const name of NAMES) {
    let values = '';
    for (let attempt = 1; values === ''; attempt += 1) {
      try {
        values = await runWorker(name, directory, after_, 'read', names);
      } catch (error) {
        if (attempt === 150) throw error;
        await delay(200);
      }
    }
    assert.deepEqual(JSON.parse(values), [1, 1, 1], `${name} reads the session from the replica that took over, with a dead node among its seeds`);
  }
});
