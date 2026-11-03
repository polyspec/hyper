// Installs the Redis server and the phpredis extension that the session tests run against (HY-115) into var/redis: the
// release archive of Redis by its sha256, built from its source. Usage: node scripts/install-redis.mts VERSION SHA256 DIRECTORY.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [version, digest, directory] = process.argv.slice(2);
if (version === undefined || digest === undefined || directory === undefined) {
  process.stderr.write('Usage: node scripts/install-redis.mts VERSION SHA256 DIRECTORY\n');
  process.exit(2);
}

function run(command: string, args: string[], cwd?: string): void {
  const { MAKEFLAGS: _flags, MFLAGS: _short, MAKELEVEL: _level, ...env } = process.env;
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} ended with ${result.status ?? result.signal}`);
}

const work = path.join(directory, 'source');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const url = `https://github.com/redis/redis/releases/download/${version}/redis-full.tar.gz`;
process.stdout.write(`[install-redis] download ${url}\n`);
const response = await fetch(url);
if (!response.ok) throw new Error(`${url} answered ${response.status}`);
const archive = Buffer.from(await response.arrayBuffer());
const actual = createHash('sha256').update(archive).digest('hex');
if (actual !== digest) throw new Error(`${url} has the sha256 ${actual}, not ${digest}`);
const file = path.join(work, 'redis.tar.gz');
writeFileSync(file, archive);
process.stdout.write('[install-redis] extract\n');
run('tar', ['-xzf', file, '--strip-components=1', '-C', work]);
process.stdout.write('[install-redis] build redis-server\n');
run('make', ['-C', 'src', 'redis-server', 'MALLOC=libc', 'BUILD_TLS=no', `-j${String(navigator.hardwareConcurrency)}`], work);
copyFileSync(path.join(work, 'src/redis-server'), path.join(directory, 'redis-server'));
rmSync(work, { recursive: true, force: true });
process.stdout.write(`[install-redis] ${path.join(directory, 'redis-server')}\n`);
