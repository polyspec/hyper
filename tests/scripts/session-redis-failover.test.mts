// The Redis sessions on a primary with a replica that Redis Sentinel promotes, and over TLS with an ACL user (HY-115): real
// Redis servers, real Sentinels, the PHP server through real phpredis and the HTTP servers of the board.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { createClient } from 'redis';

import { stopServers } from '../../scripts/board-servers.mts';
import { post, requireServers, shareAcross, startBoards } from './session-board.mts';
import { ask, certificates, EXTENSION, freePort, startRedis, stopRedis, until, type Secure } from './session-redis-server.mts';
import { COMMANDS, IDENTIFIER, NAMES, ROOT, run as runWorker, type Server } from './session-workers.mts';

const KEY = `PHPREDIS_SESSION:${IDENTIFIER}`;
const RECORD = 'a:1:{s:1:"n";i:0;}';
const REDIS = path.join(ROOT, 'var/redis/redis-server');
let directory = '';
const processes: ChildProcess[] = [];

before(() => {
  requireServers();
  directory = mkdtempSync(path.join(tmpdir(), 'hyper-session-failover-'));
});

after(async () => {
  await stopServers(processes);
  rmSync(directory, { recursive: true, force: true });
});

interface Node { name: string; port: string; server: ChildProcessWithoutNullStreams }

// A primary, a replica and three Sentinels with a quorum of two, with or without TLS and the ACL user.
class Topology {
  readonly nodes: Node[] = [];
  readonly sentinels: string[] = [];

  private readonly prefix: string;
  private readonly secure: Secure | undefined;

  constructor(prefix: string, secure?: Secure) {
    this.prefix = prefix;
    this.secure = secure;
  }

  // Runs a command on a server of the topology.
  ask(port: string, ...words: string[]): Promise<unknown> {
    return ask(port, this.secure, ...words);
  }

  // The settings of TLS, as words of a server and as lines of a Sentinel.
  private tlsSettings(port: string): string[] {
    if (this.secure === undefined) return ['port', port];
    const { certificate, key, ca } = this.secure;
    return ['port', '0', 'tls-port', port, 'tls-cert-file', certificate, 'tls-key-file', key, 'tls-ca-cert-file', ca, 'tls-auth-clients', 'no', 'tls-replication', 'yes'];
  }

  // Writes the ACL of the secure topology, and returns the configuration file that a server starts with.
  private access(name: string): string[] {
    if (this.secure === undefined) return [];
    const file = path.join(directory, `${name}.conf`);
    writeFileSync(file, ['user default off', `user hyper on >${this.secure.password} ~* &* +@all`, ''].join('\n'));
    return [file, '--masteruser', 'hyper', '--masterauth', this.secure.password];
  }

  // Starts a Redis server in a directory of its own, which holds its data when it starts again.
  async startNode(name: string, port: string, settings: string[]): Promise<Node> {
    const own = path.join(directory, name);
    mkdirSync(own, { recursive: true });
    const words = this.tlsSettings(port).map((word, index) => (index % 2 === 0 ? `--${word}` : word));
    const server = await startRedis(own, port, [...this.access(name), ...words, ...settings]);
    processes.push(server);
    return { name, port, server };
  }

  async linked(node: Node): Promise<boolean> {
    return String(await this.ask(node.port, 'INFO', 'replication')).includes('master_link_status:up');
  }

  // Starts the servers and the Sentinels, and resolves when each Sentinel sees all of them.
  async start(): Promise<void> {
    const first = await this.startNode(`${this.prefix}-a`, await freePort(), []);
    const second = await this.startNode(`${this.prefix}-b`, await freePort(), ['--replicaof', '127.0.0.1', first.port]);
    this.nodes.push(first, second);
    await until(() => this.linked(second));
    for (const index of [0, 1, 2]) {
      const port = await freePort();
      const file = path.join(directory, `${this.prefix}-sentinel-${String(index)}.conf`);
      const pairs = this.tlsSettings(port);
      const lines = pairs.flatMap((word, position) => (position % 2 === 0 ? [`${word} ${String(pairs[position + 1])}`] : []));
      const auth = this.secure === undefined ? [] : [
        'user default off',
        `user hyper on >${this.secure.password} ~* &* +@all`,
        'sentinel sentinel-user hyper',
        `sentinel sentinel-pass ${this.secure.password}`,
      ];
      const monitor = [`sentinel monitor hyper 127.0.0.1 ${first.port} 2`, 'sentinel down-after-milliseconds hyper 1000', 'sentinel failover-timeout hyper 5000'];
      const peer = this.secure === undefined ? [] : ['sentinel auth-user hyper hyper', `sentinel auth-pass hyper ${this.secure.password}`];
      writeFileSync(file, [...lines, 'bind 127.0.0.1', `dir ${directory}`, ...auth, ...monitor, ...peer, ''].join('\n'));
      processes.push(spawn(REDIS, [file, '--sentinel'], { stdio: 'ignore' }));
      this.sentinels.push(port);
    }
    for (const port of this.sentinels) {
      await until(async () => String(await this.ask(port, 'SENTINEL', 'CKQUORUM', 'hyper')).includes('OK 3'));
      await until(async () => {
        const replicas = await this.ask(port, 'SENTINEL', 'REPLICAS', 'hyper');
        return Array.isArray(replicas) && replicas.length === 1;
      });
    }
  }

  // Returns the node that the Sentinels name as the primary.
  async primary(): Promise<Node> {
    const named = await this.ask(this.sentinels[0] ?? '', 'SENTINEL', 'GET-MASTER-ADDR-BY-NAME', 'hyper');
    assert.ok(Array.isArray(named));
    const node = this.nodes.find((item) => item.port === String(named[1]));
    assert.ok(node !== undefined, `the Sentinels name the port ${String(named[1])}`);
    return node;
  }

  // Kills the primary and resolves when the Sentinels name the replica.
  async failOver(): Promise<Node> {
    const old = await this.primary();
    await stopRedis(old.server, 'SIGKILL');
    await until(async () => (await this.primary()).port !== old.port);
    return old;
  }

  // Waits until the replica holds what the primary acknowledged.
  async replicated(node: Node): Promise<void> {
    assert.equal(await this.ask(node.port, 'WAIT', '1', '10000'), 1, 'the replica acknowledged');
  }
}

async function topology(prefix: string, secure?: Secure): Promise<Topology> {
  const started = new Topology(prefix, secure);
  await started.start();
  return started;
}

// Returns the numbers of a JSON list that a worker printed.
function numbers(text: string): number[] {
  const values: unknown = JSON.parse(text);
  assert.ok(Array.isArray(values));
  return values.map(Number);
}

// Runs a request of a server until it succeeds, while the clients follow a failover.
async function retried(name: Server, env: Record<string, string>, ...args: string[]): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await runWorker(name, directory, env, ...args);
    } catch (error) {
      if (attempt === 150) throw error;
      await delay(200);
    }
  }
}

// Each server writes a value on the primary, the primary fails, and each server writes another on the new primary and reads
// them all. Returns the old primary and the names of the values.
async function writeAcrossFailover(redis: Topology, env: Record<string, string>): Promise<{ old: Node; names: string }> {
  const primary = await redis.primary();
  await redis.ask(primary.port, 'SET', KEY, RECORD);
  for (const name of NAMES) await runWorker(name, directory, env, 'write', JSON.stringify({ [`before_${name}`]: 1 }));
  await redis.replicated(primary);
  const old = await redis.failOver();
  for (const name of NAMES) await retried(name, env, 'write', JSON.stringify({ [`after_${name}`]: 1 }));
  const names = JSON.stringify(NAMES.flatMap((name) => [`before_${name}`, `after_${name}`]));
  for (const name of NAMES) assert.deepEqual(JSON.parse(await retried(name, env, 'read', names)), [1, 1, 1, 1, 1, 1], `${name} reads what every server wrote before and after`);
  return { old, names };
}

test('a request fails when no Sentinel names the primary and goes past a Sentinel that does not answer (HY-115)', { timeout: 180_000 }, async () => {
  const redis = await topology('ask');
  const { sentinels } = redis;
  const dead = await freePort();
  await redis.ask((await redis.primary()).port, 'SET', KEY, RECORD);
  for (const name of NAMES) {
    await runWorker(name, directory, { HYPER_SESSION_SENTINEL: [dead, ...sentinels].join(','), PHP_PREFIX: EXTENSION }, 'write', `{"${name}":1}`);
    await assert.rejects(runWorker(name, directory, { HYPER_SESSION_SENTINEL: dead, PHP_PREFIX: EXTENSION }, 'write', '{"x":1}'), `${name} fails without a Sentinel`);
  }
  const values = JSON.parse(await runWorker('php', directory, { HYPER_SESSION_SENTINEL: sentinels.join(','), PHP_PREFIX: EXTENSION }, 'read', '["php","python","node","x"]')) as unknown;
  assert.deepEqual(values, [1, 1, 1, null]);
});

test('the three servers go on with a session through two failovers that Sentinel makes (HY-115)', { timeout: 180_000 }, async () => {
  const redis = await topology('share');
  const env = { HYPER_SESSION_SENTINEL: redis.sentinels.join(','), PHP_PREFIX: EXTENSION };
  const { old, names } = await writeAcrossFailover(redis, env);

  // The old primary comes back as a replica of the new one, and a second failover keeps the session.
  const back = await redis.startNode(old.name, old.port, []);
  redis.nodes[redis.nodes.indexOf(old)] = back;
  await until(() => redis.linked(back));
  await redis.replicated(await redis.primary());
  await redis.failOver();
  for (const name of NAMES) assert.deepEqual(JSON.parse(await retried(name, env, 'read', names)), [1, 1, 1, 1, 1, 1], `${name} reads the session after the second failover`);
});

test('the HTTP servers answer status 500 during a failover and go on with the session after it (HY-115)', { timeout: 180_000 }, async () => {
  const redis = await topology('http');
  const children: ChildProcess[] = [];
  const addresses = [await freePort(), ...redis.sentinels].map((port) => `127.0.0.1:${port}`).join(',');
  try {
    const boards = await startBoards(children, { BOARD_DB: path.join(directory, 'failover.sqlite'), BOARD_SENTINEL: addresses }, []);
    const [session] = await shareAcross(boards);
    assert.ok(session !== undefined);
    await redis.replicated(await redis.primary());
    await redis.failOver();
    for (const board of boards) {
      let response: Response = await post(board, session.cookie, session.token, `after ${board.name}`);
      while (response.status === 500) {
        await delay(200);
        response = await post(board, session.cookie, session.token, `after ${board.name}`);
      }
      assert.equal(response.status, 303, `${board.name} goes on with the session and its token after the failover`);
    }
    await shareAcross(boards);
  } finally {
    await stopServers(children);
  }
});

test('a failover while the three servers write one session keeps the acknowledged writes and loses no update after it (HY-115)', { timeout: 180_000 }, async () => {
  const redis = await topology('load');
  const env = { HYPER_SESSION_SENTINEL: redis.sentinels.join(','), HYPER_SESSION_EXPIRE: '2', PHP_PREFIX: EXTENSION };
  const primary = await redis.primary();
  await redis.ask(primary.port, 'SET', KEY, RECORD);
  const writers = NAMES.map((name) => {
    const { command, prefix } = COMMANDS[name];
    return spawn(command, [...(name === 'php' ? [EXTENSION] : []), ...prefix, directory, IDENTIFIER, 'count', '10000000', name], { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'ignore' });
  });
  processes.push(...writers);
  const counted = (record: unknown): number => Number(/"n";i:(\d+);/.exec(String(record))?.[1] ?? 0);
  let acknowledged = 0;
  await until(async () => {
    const record = await redis.ask(primary.port, 'GET', KEY);
    await redis.replicated(primary);
    acknowledged = counted(record);
    return acknowledged >= 50;
  });
  await redis.failOver();
  for (const writer of writers) {
    if (writer.exitCode === null && writer.signalCode === null) {
      const ended = once(writer, 'exit');
      writer.kill('SIGKILL');
      await ended;
    }
  }
  const names = '["n","php","python","node"]';
  const [n = -1, php = 0, python = 0, node = 0] = numbers(await retried('php', env, 'read', names));
  assert.ok(n >= acknowledged, `the record holds ${String(n)} updates of the ${String(acknowledged)} that the replica acknowledged`);
  assert.equal(n, php + python + node, 'each update of the record is whole');
  for (const name of NAMES) await runWorker(name, directory, env, 'count', '10', name);
  const [later] = numbers(await retried('php', env, 'read', names));
  assert.equal(later, n + 30, 'requests after the failover lose no update');
});

test('the three servers share a session over TLS with an ACL user and no other client reaches it (HY-115)', { timeout: 120_000 }, async () => {
  const { ca, certificate, key } = certificates(directory);
  const port = await freePort();
  const own = path.join(directory, 'tls');
  mkdirSync(own);
  const configuration = path.join(own, 'redis.conf');
  writeFileSync(configuration, ['user default off', 'user hyper on >secret ~* &* +@all', ''].join('\n'));
  const server = await startRedis(own, port, [configuration, '--port', '0', '--tls-port', port, '--tls-cert-file', certificate, '--tls-key-file', key, '--tls-ca-cert-file', ca, '--tls-auth-clients', 'no']);
  processes.push(server);
  const plain = { HYPER_SESSION_REDIS: port, PHP_PREFIX: EXTENSION, HYPER_SESSION_RETRIES: '1' };
  const env = { ...plain, HYPER_SESSION_TLS_CA: ca, HYPER_SESSION_USER: 'hyper', HYPER_SESSION_PASSWORD: 'secret', HYPER_SESSION_RETRIES: '1000000' };
  const client = await createClient({ socket: { host: '127.0.0.1', port: Number(port), tls: true, ca: readFileSync(ca) }, username: 'hyper', password: 'secret' }).on('error', () => {}).connect();
  try {
    await client.set(KEY, RECORD);
    await Promise.all(NAMES.map((name) => runWorker(name, directory, env, 'count', '50', name)));
    assert.deepEqual(JSON.parse(await runWorker('php', directory, env, 'read', '["n","php","python","node"]')), [150, 50, 50, 50]);
    for (const name of NAMES) {
      await assert.rejects(runWorker(name, directory, { ...env, HYPER_SESSION_PASSWORD: 'wrong' }, 'write', '{"x":1}'), `${name} is refused with a wrong password`);
      await assert.rejects(runWorker(name, directory, plain, 'write', '{"x":1}'), `${name} is refused without TLS`);
      await assert.rejects(runWorker(name, directory, { ...plain, HYPER_SESSION_TLS_CA: ca }, 'write', '{"x":1}'), `${name} is refused as the default user`);
    }
    assert.deepEqual(JSON.parse(await runWorker('php', directory, env, 'read', '["n","x"]')), [150, null], 'the refused requests wrote nothing');
  } finally {
    client.destroy();
  }
});

test('the three servers go on through a failover with Sentinels and Redis servers that take only TLS and the ACL user (HY-115)', { timeout: 180_000 }, async () => {
  const secure = certificates(directory);
  const redis = await topology('secure', secure);
  const env = { HYPER_SESSION_SENTINEL: redis.sentinels.join(','), HYPER_SESSION_TLS_CA: secure.ca, HYPER_SESSION_USER: 'hyper', HYPER_SESSION_PASSWORD: secure.password, PHP_PREFIX: EXTENSION };
  await writeAcrossFailover(redis, env);
});
