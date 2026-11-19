// Measures the capacity of one Redis server for the sessions of the three servers (HY-115): each process runs requests of a
// session of its own, which take the lock, read, write and release it. The clients run on the same machine as the server, so the
// requests per second show what the machine gives; the requests per second of Redis CPU show the cost to the Redis server, the
// limit of one Redis server, which runs commands on one thread. Each --extension loads a PHP extension into the PHP
// server in the given order: the json extension, then the template extension that requires it, then polyspec_hyper
// (HY-48.23, HY-132.2), which `make bench-sessions` passes from PHP_SERVER_EXTENSIONS; the benchmark measures nothing
// with a PHP that does not load the three.
// Usage: node benchmarks/sessions.mts --requests <n> [--json] --extension <library>...
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { createClient } from 'redis';

import { requireBuilt } from '../tests/scripts/requires.mts';
import { EXTENSION, freePort, startRedis, stopRedis } from '../tests/scripts/session-redis-server.mts';
import { COMMANDS, NAMES, PHP_WORKER, ROOT, type Server } from '../tests/scripts/session-workers.mts';

const { values } = parseArgs({ options: { requests: { type: 'string' }, json: { type: 'boolean', default: false }, extension: { type: 'string', multiple: true } } });
const requests = Number(values.requests);
if (!Number.isInteger(requests) || requests < 1) throw new Error('--requests must name a positive number');

// The extensions of a PHP server of a run, which PHP loads in the order of the arguments.
const PHP_SERVER_MODULES = ['polyspec_json', 'polyspec_template', 'polyspec_hyper'];
const libraries = values.extension ?? [];
const extensions = libraries.map((file) => `-dextension=${path.resolve(file)}`);
const probe = spawnSync('php', [...extensions, '-r', 'echo json_encode(array_values(array_filter(array_slice($argv, 1), static fn (string $name): bool => !extension_loaded($name))));', '--', ...PHP_SERVER_MODULES], { encoding: 'utf8' });
const missing: unknown = probe.status === 0 ? JSON.parse(probe.stdout.slice(probe.stdout.lastIndexOf('['))) : PHP_SERVER_MODULES;
if (!Array.isArray(missing) || missing.length > 0) {
  throw new Error(`PHP did not load ${Array.isArray(missing) ? missing.join(', ') : 'its extensions'} with the --extension arguments ${JSON.stringify(libraries)}; make bench-sessions passes PHP_SERVER_EXTENSIONS`);
}

requireBuilt('hyper-install-redis', 'var/redis/redis-server', 'var/redis/redis.so');
requireBuilt('hyper-install-python', 'packages/python/.venv/bin/python');
requireBuilt('hyper-install-php', 'vendor/autoload.php');

const directory = mkdtempSync(path.join(tmpdir(), 'hyper-bench-sessions-'));
const port = await freePort();
const server = await startRedis(directory, port);
const client = await createClient({ socket: { port: Number(port) } }).connect();

// Returns the seconds of CPU that the Redis server has used.
async function redisCpu(): Promise<number> {
  const info = await client.info('cpu');
  const seconds = (name: string): number => Number(new RegExp(`${name}:([0-9.]+)`).exec(info)?.[1]);
  return seconds('used_cpu_user') + seconds('used_cpu_sys');
}

// Runs `processes` processes of a server, each with a session of its own, and resolves when each has ended without an error.
async function runProcesses(name: Server, processes: number): Promise<void> {
  const { command, prefix } = COMMANDS[name];
  const ended = [];
  for (let index = 0; index < processes; index += 1) {
    const id = `${name}${String(index)}`.padEnd(32, 'a');
    await client.set(`PHPREDIS_SESSION:${id}`, 'a:1:{s:1:"n";i:0;}');
    const child = spawn(command, [...(name === 'php' ? [...extensions, EXTENSION, PHP_WORKER] : prefix), directory, id, 'count', String(requests), name], {
      cwd: ROOT,
      env: { ...process.env, HYPER_SESSION_REDIS: port, HYPER_SESSION_PERSISTENT: '1' },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    ended.push(once(child, 'exit').then(([code]) => {
      if (code !== 0) throw new Error(`a process of the ${name} server ended with ${String(code)}`);
    }));
  }
  await Promise.all(ended);
}

const results = [];
try {
  for (const name of NAMES) {
    for (const processes of [1, 4]) {
      process.stderr.write(`[bench-sessions] ${name}, ${String(processes)} processes\n`);
      const cpu = await redisCpu();
      const started = performance.now();
      await runProcesses(name, processes);
      const seconds = (performance.now() - started) / 1000;
      const total = requests * processes;
      const used = await redisCpu() - cpu;
      results.push({
        server: name,
        processes,
        requests: total,
        seconds,
        requestsPerSecond: Math.round(total / seconds),
        redisCpuSeconds: used,
        requestsPerRedisCpuSecond: Math.round(total / used),
      });
    }
  }
} finally {
  client.destroy();
  await stopRedis(server, 'SIGKILL');
  rmSync(directory, { recursive: true, force: true });
}

if (values.json) {
  process.stdout.write(`${JSON.stringify(results)}\n`);
} else {
  process.stdout.write(`load average ${loadavg().map((item) => item.toFixed(1)).join(' ')}, ${String(requests)} requests per process\n`);
  process.stdout.write('| Server | Processes | Requests/s | Requests per second of Redis CPU |\n|---|---|---|---|\n');
  for (const item of results) process.stdout.write(`| ${item.server} | ${String(item.processes)} | ${String(item.requestsPerSecond)} | ${String(item.requestsPerRedisCpuSecond)} |\n`);
}
