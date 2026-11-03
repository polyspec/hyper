// The Redis server of a run of the session tests (HY-115) and a request of a server that holds its session until a line
// of its input.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before } from 'node:test';

import { requireBuilt } from './requires.mts';
import { COMMANDS, IDENTIFIER, ROOT, type Server } from './session-workers.mts';

export const EXTENSION = `-dextension=${path.join(ROOT, 'var/redis/redis.so')}`;

// Returns a TCP port that is free now.
async function freePort(): Promise<string> {
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
export async function startRedis(directory: string, port: string): Promise<ChildProcessWithoutNullStreams> {
  const server = spawn(path.join(ROOT, 'var/redis/redis-server'), ['--port', port, '--bind', '127.0.0.1', '--save', '', '--appendonly', 'yes', '--dir', directory]);
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
    requireBuilt('packages', 'packages/server/ts/dist/index.js');
    requireBuilt('hyper-install-python', 'packages/server/python/.venv/bin/python');
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
export async function holding(name: Server, directory: string, env: Record<string, string>): Promise<ChildProcessWithoutNullStreams> {
  const { command, prefix } = COMMANDS[name];
  const holder = spawn(command, [...(name === 'php' ? [EXTENSION] : []), ...prefix, directory, IDENTIFIER, 'stale'], { cwd: ROOT, env: { ...process.env, ...env } });
  await once(holder.stdout, 'data');
  return holder;
}
