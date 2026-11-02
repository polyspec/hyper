// The PHP, Node and Python servers share the sessions of one directory (HY-104): their processes run the requests of one
// session one after another, each reads what another wrote as the same values, and the lock of a process that ended is
// released. Each server is one real process of its package over the session file.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { requireBuilt } from './requires.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKERS = path.join(ROOT, 'tests/scripts/fixtures/session-worker');
type Server = 'php' | 'python' | 'node';
const NAMES: Server[] = ['php', 'python', 'node'];
const PYTHON = path.join(ROOT, 'packages/server/python/.venv/bin/python');
const COMMANDS: Record<Server, { command: string; prefix: string[] }> = {
  php: { command: 'php', prefix: [path.join(WORKERS, 'worker.php')] },
  python: { command: PYTHON, prefix: [path.join(WORKERS, 'worker.py')] },
  node: { command: process.execPath, prefix: ['--no-warnings', path.join(WORKERS, 'worker.mjs')] },
};
const IDENTIFIER = 'a'.repeat(32);
const PROCESSES = 3;
const REQUESTS = 300;

function directoryOf(t: TestContext): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-session-shared-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// Runs one command of the worker of a server and returns what it printed.
async function run(server: Server, directory: string, ...args: string[]): Promise<string> {
  const { command, prefix } = COMMANDS[server];
  const { stdout } = await promisify(execFile)(command, [...prefix, directory, IDENTIFIER, ...args], { cwd: ROOT, maxBuffer: 1 << 24 });
  return stdout;
}

const file = (directory: string) => path.join(directory, `sess_${IDENTIFIER}`);

test('processes of the three servers that write one session at the same time lose no update (HY-104)', { timeout: 120_000 }, async (t) => {
  requireBuilt('packages', 'packages/server/ts/dist/index.js');
  requireBuilt('hyper-install-python', 'packages/server/python/.venv/bin/python');
  requireBuilt('hyper-install-php', 'vendor/autoload.php');
  const directory = directoryOf(t);
  writeFileSync(file(directory), 'a:1:{s:1:"n";i:0;}');
  await Promise.all(NAMES.flatMap((server) => Array.from({ length: PROCESSES }, () => run(server, directory, 'count', String(REQUESTS), server))));
  const total = PROCESSES * REQUESTS;
  const read: unknown = JSON.parse(await run('php', directory, 'read', JSON.stringify(['n', 'php', 'python', 'node'])));
  assert.deepEqual(read, [3 * total, total, total, total]);
  assert.deepEqual(readdirSync(directory), [path.basename(file(directory))], 'the servers leave only the session file');
});

// The values that each server writes and each server reads, with the forms that a PHP array cannot tell apart.
const VALUES = String.raw`{"text":"h\u00e9llo","int":7,"negative":-3,"float":1.5,"yes":true,"no":false,"nothing":null,"list":[1,"a",[]],"map":{"a":{"b":[1]}},"numbered":{"0":"a","1":"b"},"mixed":{"5":"x","a":"y"},"empty":{}}`;
const NAMED = ['text', 'int', 'negative', 'float', 'yes', 'no', 'nothing', 'list', 'map', 'numbered', 'mixed', 'empty'];
const CANONICAL = [
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

for (const writer of NAMES) {
  test(`the values that the ${writer} server writes are the same values in every server (HY-104)`, { timeout: 60_000 }, async (t) => {
    const directory = directoryOf(t);
    writeFileSync(file(directory), '');
    await run(writer, directory, 'write', VALUES);
    const record = readFileSync(file(directory));
    for (const reader of NAMES) {
      const read: unknown = JSON.parse(await run(reader, directory, 'read', JSON.stringify(NAMED)));
      assert.deepEqual(read, CANONICAL, `${reader} reads what ${writer} wrote`);
      assert.deepEqual(readFileSync(file(directory)), record, `${reader} keeps the bytes of a record that it does not change`);
    }
  });
}

test('the lock of a process that ended is released and the session goes on (HY-104)', { timeout: 60_000 }, async (t) => {
  const directory = directoryOf(t);
  writeFileSync(file(directory), 'a:1:{s:1:"n";i:0;}');
  const holder = spawn(PYTHON, [...COMMANDS.python.prefix, directory, IDENTIFIER, 'hold'], { cwd: ROOT, stdio: ['pipe', 'pipe', 'inherit'] });
  t.after(() => holder.kill('SIGKILL'));
  await new Promise((resolve) => holder.stdout.once('data', resolve));
  const waiting = NAMES.map((server) => run(server, directory, 'count', '1', server));
  holder.kill('SIGKILL');
  await Promise.all(waiting);
  const read: unknown = JSON.parse(await run('php', directory, 'read', JSON.stringify(['n'])));
  assert.deepEqual(read, [3]);
});
