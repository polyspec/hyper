// The Redis server of a run of the session tests (HY-115) and a request of a server that holds its session until a line
// of its input.
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { createClient } from 'redis';

import { requireBuilt } from './requires.mts';
import { COMMANDS, IDENTIFIER, ROOT, type Server } from './session-workers.mts';

// A certificate authority, the certificate of the servers that it signed, and the password of the ACL user hyper.
export interface Secure { ca: string; certificate: string; key: string; password: string }

// Writes a certificate authority and a certificate of 127.0.0.1 that it signs, valid for the run.
export function certificates(directory: string): Secure {
  const file = (name: string): string => path.join(directory, name);
  const openssl = (...args: string[]) => execFileSync('openssl', args, { stdio: 'ignore' });
  openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=hyper test', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-keyout', file('ca.key'), '-out', file('ca.pem'));
  openssl('req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=127.0.0.1', '-keyout', file('server.key'), '-out', file('server.csr'));
  writeFileSync(file('san.ext'), 'authorityKeyIdentifier=keyid,issuer\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth,clientAuth\nsubjectAltName=IP:127.0.0.1\n');
  openssl('x509', '-req', '-days', '2', '-in', file('server.csr'), '-CA', file('ca.pem'), '-CAkey', file('ca.key'), '-CAcreateserial', '-extfile', file('san.ext'), '-out', file('server.pem'));
  return { ca: file('ca.pem'), certificate: file('server.pem'), key: file('server.key'), password: 'secret' };
}

// Runs a command on one server and returns its reply; a connection that fails rejects at once, and a redirection is not followed.
export async function ask(port: string, secure: Secure | undefined, ...words: string[]): Promise<unknown> {
  const tls = secure === undefined ? {} : { host: '127.0.0.1', tls: true as const, ca: readFileSync(secure.ca) };
  const client = await createClient({
    socket: { port: Number(port), reconnectStrategy: false, ...tls },
    disableOfflineQueue: true,
    ...(secure === undefined ? {} : { username: 'hyper', password: secure.password }),
  }).on('error', () => {}).connect();
  try {
    return await client.sendCommand(words);
  } finally {
    client.destroy();
  }
}

// Repeats a check until it holds. The timeout of a test fails the test and leaves a check that never holds repeating, so
// the wait between two checks does not keep the process: while a test waits, the servers of the file keep it, and after
// the file stopped them a check that is left ends with the process (HR-87).
export async function until(check: () => Promise<boolean>): Promise<void> {
  for (;;) {
    if (await check().catch(() => false)) return;
    await delay(100, undefined, { ref: false });
  }
}

export const EXTENSION = `-dextension=${path.join(ROOT, 'var/redis/redis.so')}`;

// Returns a TCP port that is free now.
export async function freePort(): Promise<string> {
  const free = createServer();
  free.listen(0, '127.0.0.1');
  await once(free, 'listening');
  const address = free.address();
  if (address === null || typeof address === 'string') throw new Error('no TCP port is free');
  free.close();
  await once(free, 'close');
  return String(address.port);
}

// Starts a Redis server of the run that keeps its data with the append-only file in `directory`, and resolves when it
// accepts connections.
export async function startRedis(directory: string, port: string, settings: string[] = ['--port', port]): Promise<ChildProcessWithoutNullStreams> {
  const server = spawn(path.join(ROOT, 'var/redis/redis-server'), [...settings, '--bind', '127.0.0.1', '--save', '', '--appendonly', 'yes', '--dir', directory]);
  await new Promise<void>((resolve, reject) => {
    server.once('exit', (code) => reject(new Error(`the Redis server ended with ${String(code)}`)));
    let output = '';
    server.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('Ready to accept connections')) resolve();
    });
  });
  server.removeAllListeners('exit');
  return server;
}

// Ends a Redis server with a signal and resolves when it has ended.
export async function stopRedis(server: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): Promise<void> {
  const ended = once(server, 'exit');
  server.kill(signal);
  await ended;
}

// The Redis server of a test file: its hooks start it in a directory of its own, after they checked the inputs of the
// session workers, call `started` when it accepts connections, and call `ending`, end it and remove the directory after the
// file.
export interface RedisRun { directory: string; port: string; server: ChildProcessWithoutNullStreams | null }

export function redisRun(prefix: string, started: () => Promise<void>, ending: () => Promise<unknown>): RedisRun {
  const run: RedisRun = { directory: '', port: '', server: null };
  before(async () => {
    requireBuilt('hyper-install-redis', 'var/redis/redis-server', 'var/redis/redis.so');
    requireBuilt('packages', 'packages/ts/dist/index.js');
    requireBuilt('hyper-install-python', 'packages/python/.venv/bin/python');
    requireBuilt('hyper-install-php', 'vendor/autoload.php');
    run.directory = mkdtempSync(path.join(tmpdir(), prefix));
    run.port = await freePort();
    run.server = await startRedis(run.directory, run.port);
    await started();
  });
  after(async () => {
    await ending();
    if (run.server !== null) await stopRedis(run.server, 'SIGKILL');
    rmSync(run.directory, { recursive: true, force: true });
  });
  return run;
}

// Starts a request of a server that has written a value, and resolves when it holds the lock and waits for a line.
export async function holding(name: Server, directory: string, env: Record<string, string>, command_ = 'stale'): Promise<ChildProcessWithoutNullStreams> {
  const { command, prefix } = COMMANDS[name];
  const holder = spawn(command, [...(name === 'php' ? [EXTENSION] : []), ...prefix, directory, IDENTIFIER, command_], { cwd: ROOT, env: { ...process.env, ...env } });
  await once(holder.stdout, 'data');
  return holder;
}
