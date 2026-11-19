// The Redis server of a run of the session tests (HY-115) and a request of a server that holds its session until a line
// of its input.
import { execFileSync, spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before } from 'node:test';

import { createClient, type RedisClientType } from 'redis';

import { stopServers } from '../../scripts/board-servers.mts';
import { NODE_ADDON, requireBuilt } from './requires.mts';
import { COMMANDS, HYPER_EXT, IDENTIFIER, ROOT, type Server } from './session-workers.mts';

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

// A client of one server that does not reconnect: a connection that fails rejects at once, and a redirection is not followed.
function connectTo(port: string, secure: Secure | undefined): Promise<RedisClientType> {
  const tls = secure === undefined ? {} : { host: '127.0.0.1', tls: true as const, ca: readFileSync(secure.ca) };
  return createClient({
    socket: { port: Number(port), reconnectStrategy: false, ...tls },
    disableOfflineQueue: true,
    ...(secure === undefined ? {} : { username: 'hyper', password: secure.password }),
  }).on('error', () => {}).connect();
}

// Runs a command on one server and returns its reply.
export async function ask(port: string, secure: Secure | undefined, ...words: string[]): Promise<unknown> {
  const client = await connectTo(port, secure);
  try {
    return await client.sendCommand(words);
  } finally {
    client.destroy();
  }
}

// Calls `fail` at once when one of `processes` has ended or when it ends later, and returns the function that stops the
// watch. Every wait of the session tests races the end of the processes that make its state, so a process that ended fails
// the wait with its status instead of the time limit of the test runner (H35.19-2, HR-89).
function onExit(processes: ChildProcess[], fail: (reason: string) => void): () => void {
  const watches = processes.map((child) => {
    const ended = (code: number | null, signal: NodeJS.Signals | null): void => fail(`process ${String(child.pid)} ended with ${String(code ?? signal)}`);
    if (child.exitCode !== null || child.signalCode !== null) ended(child.exitCode, child.signalCode);
    child.once('exit', ended);
    return (): void => {
      child.off('exit', ended);
    };
  });
  return (): void => {
    for (const stop of watches) stop();
  };
}

// The lines that a process of the run writes on its standard output, read once from its start: a wait searches the lines
// that came before it and then each new line, so a line that the process wrote before the wait began counts, and no line is
// read twice (H35.19-2).
export class Lines {
  private readonly lines: string[] = [];
  private partial = '';
  private readonly waiting = new Set<() => void>();
  private readonly child: ChildProcess;
  private readonly name: string;

  constructor(name: string, child: ChildProcess) {
    this.name = name;
    this.child = child;
    child.stdout?.on('data', (chunk: Buffer) => {
      const parts = (this.partial + chunk.toString()).split('\n');
      this.partial = parts.pop() ?? '';
      this.lines.push(...parts);
      // A wait that ends removes itself from the set, which the iteration of a Set allows.
      for (const look of this.waiting) look();
    });
    child.once('exit', () => {
      for (const look of this.waiting) look();
    });
  }

  // The number of lines so far, the start of a wait for a line that an action after this point makes.
  get length(): number {
    return this.lines.length;
  }

  // Resolves with the index of the first line at `from` or after it that matches, and rejects when this process or one of
  // `also` ends before such a line.
  until(from: number, matches: (line: string) => boolean, what: string, also: ChildProcess[] = []): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      let next = from;
      let stopExit = (): void => {};
      const finish = (): void => {
        this.waiting.delete(look);
        stopExit();
      };
      const failed = (reason: string): void => {
        finish();
        reject(new Error(`${this.name}: ${what}: ${reason} before the line; its last lines:\n${this.lines.slice(-20).join('\n')}`));
      };
      const look = (): void => {
        for (; next < this.lines.length; next += 1) {
          if (matches(this.lines[next] ?? '')) {
            finish();
            resolve(next);
            return;
          }
        }
        if (this.child.exitCode !== null || this.child.signalCode !== null) failed(`it ended with ${String(this.child.exitCode ?? this.child.signalCode)}`);
      };
      this.waiting.add(look);
      stopExit = onExit(also, failed);
      look();
    });
  }
}

const readers = new WeakMap<ChildProcess, Lines>();

// Starts reading the lines of a process that the run just spawned.
export function readLines(name: string, child: ChildProcess): Lines {
  const lines = new Lines(name, child);
  readers.set(child, lines);
  return lines;
}

// The lines of a process whose lines `readLines` reads.
export function linesOf(child: ChildProcess): Lines {
  const lines = readers.get(child);
  if (lines === undefined) throw new Error(`the lines of process ${String(child.pid)} are not read`);
  return lines;
}

// Resolves when `key` does not exist on the server of `port`: it subscribes to the keyspace events del and expired of the
// key first, then reads the key once, so a key that is already gone resolves at once and a key that goes later resolves by
// its event; it rejects when one of `processes` ends first (H35.19-2).
export async function keyGone(port: string, secure: Secure | undefined, key: string, processes: ChildProcess[]): Promise<void> {
  await ask(port, secure, 'CONFIG', 'SET', 'notify-keyspace-events', 'Kgx');
  await keyEvents(port, secure, key, processes, async () => (await ask(port, secure, 'EXISTS', key)) === 0, (event) => event === 'del' || event === 'expired');
}

// Subscribes to the keyspace events of `key` on the server of `port`, then calls `holds` once and again after each event
// that `counts` takes, one call at a time, and resolves when it returns true; it rejects when one of `processes` ends first.
// The caller sets notify-keyspace-events with the classes of the events.
export async function keyEvents(port: string, secure: Secure | undefined, key: string, processes: ChildProcess[], holds: () => Promise<boolean>, counts: (event: string) => boolean = () => true): Promise<void> {
  const subscriber = await connectTo(port, secure);
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let pending = false;
      let running = false;
      const stopExit = onExit(processes, (reason) => settle(new Error(`the keyspace events of ${key} on ${port}: ${reason} before the state held`)));
      function settle(error?: Error): void {
        if (settled) return;
        settled = true;
        stopExit();
        if (error === undefined) resolve();
        else reject(error);
      }
      const check = (): void => {
        if (settled) return;
        if (running) {
          pending = true;
          return;
        }
        running = true;
        holds().then((held) => {
          running = false;
          if (held) settle();
          else if (pending) {
            pending = false;
            check();
          }
        }, (error: unknown) => settle(error instanceof Error ? error : new Error(String(error))));
      };
      subscriber.subscribe(`__keyspace@0__:${key}`, (event) => {
        if (counts(event)) check();
      }).then(check, (error: unknown) => settle(error instanceof Error ? error : new Error(String(error))));
    });
  } finally {
    subscriber.destroy();
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

// Starts a Redis server of the run that keeps its data with the append-only file in `directory`, reads its lines from its
// start (`linesOf`), and resolves when it accepts connections.
export async function startRedis(directory: string, port: string, settings: string[] = ['--port', port]): Promise<ChildProcessWithoutNullStreams> {
  const server = spawn(path.join(ROOT, 'var/redis/redis-server'), [...settings, '--bind', '127.0.0.1', '--save', '', '--appendonly', 'yes', '--dir', directory]);
  await readLines(`the Redis server on ${port}`, server).until(0, (line) => line.includes('Ready to accept connections'), 'the start');
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
    requireBuilt('node-addon', NODE_ADDON);
    requireBuilt('hyper-install-python', 'packages/python/.venv/bin/python');
    requireBuilt('hyper-install-php', 'vendor/autoload.php');
    requireBuilt('hyper-ext', HYPER_EXT);
    run.directory = mkdtempSync(path.join(tmpdir(), prefix));
    run.port = await freePort();
    run.server = await startRedis(run.directory, run.port);
    await started();
  });
  after(async () => {
    await ending();
    await stopServers(holders);
    if (run.server !== null) await stopRedis(run.server, 'SIGKILL');
    rmSync(run.directory, { recursive: true, force: true });
  });
  return run;
}

// The holders that `holding` started: the hooks after a test file stop each that still runs, so that a test that fails while
// a holder waits for its line leaves no process (HR-87).
export const holders: ChildProcessWithoutNullStreams[] = [];

// Starts a request of a server that has written a value, and resolves when it holds the lock and waits for a line: when it
// printed `held` (Python and Node) or `holding` (PHP). A holder that ends before it printed that line rejects with its status
// and its output (HR-84), because PHP prints a fatal error on its standard output.
export async function holding(name: Server, directory: string, env: Record<string, string>, command_ = 'stale'): Promise<ChildProcessWithoutNullStreams> {
  const { command, prefix } = COMMANDS[name];
  const holder = spawn(command, [...(name === 'php' ? [EXTENSION] : []), ...prefix, directory, IDENTIFIER, command_], { cwd: ROOT, env: { ...process.env, ...env } });
  holders.push(holder);
  let output = '';
  const collect = (chunk: Buffer) => {
    output += chunk.toString();
  };
  holder.stderr.on('data', collect);
  try {
    await new Promise<void>((resolve, reject) => {
      holder.stdout.on('data', (chunk: Buffer) => {
        collect(chunk);
        if (/^(?:held|holding)$/m.test(output)) resolve();
      });
      holder.once('error', reject);
      holder.once('close', (code, signal) => reject(new Error(`the ${name} holder (${command_}) ended with ${String(code ?? signal)} before it held the lock:\n${output}`)));
    });
  } finally {
    holder.stdout.removeAllListeners('data');
    holder.stderr.off('data', collect);
    holder.removeAllListeners('close');
    holder.removeAllListeners('error');
  }
  return holder;
}
