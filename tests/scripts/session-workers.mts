// The workers of the session tests (HY-104, HY-115): one real process of the PHP, Python or Node server over one session.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKERS = path.join(ROOT, 'tests/scripts/fixtures/session-worker');
export type Server = 'php' | 'python' | 'node';
export const NAMES: Server[] = ['php', 'python', 'node'];
export const PYTHON = path.join(ROOT, 'packages/python/.venv/bin/python');
export const COMMANDS: Record<Server, { command: string; prefix: string[] }> = {
  php: { command: 'php', prefix: [path.join(WORKERS, 'worker.php')] },
  python: { command: PYTHON, prefix: [path.join(WORKERS, 'worker.py')] },
  node: { command: process.execPath, prefix: ['--no-warnings', path.join(WORKERS, 'worker.mjs')] },
};
export const IDENTIFIER = 'a'.repeat(32);

// Runs one command of the worker of a server and returns what it printed.
export async function run(server: Server, directory: string, env: Record<string, string>, ...args: string[]): Promise<string> {
  const { command, prefix } = COMMANDS[server];
  const { stdout } = await promisify(execFile)(command, [...(server === 'php' && env.PHP_PREFIX !== undefined ? [env.PHP_PREFIX] : []), ...prefix, directory, IDENTIFIER, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    maxBuffer: 1 << 24,
  });
  return stdout;
}

// The values that each server writes and each server reads, with the forms that a PHP array cannot tell apart.
export const VALUES = String.raw`{"text":"h\u00e9llo","int":7,"negative":-3,"float":1.5,"yes":true,"no":false,"nothing":null,"list":[1,"a",[]],"map":{"a":{"b":[1]}},"numbered":{"0":"a","1":"b"},"mixed":{"5":"x","a":"y"},"empty":{}}`;
export const NAMED = ['text', 'int', 'negative', 'float', 'yes', 'no', 'nothing', 'list', 'map', 'numbered', 'mixed', 'empty'];
export const CANONICAL = [
  'héllo',
  7,
  -3,
  1.5,
  true,
  false,
  null,
  [1, 'a', []],
  { map: [['a', { map: [['b', [1]]] }]] },
  { map: [['0', 'a'], ['1', 'b']] },
  { map: [['5', 'x'], ['a', 'y']] },
  { map: [] },
];

