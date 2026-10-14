// Tests that the servers of a run never outlive it (HY-87, scripts/board-servers.mts): when a server of the board
// fails to start, the servers that started have exited before the start rejects, and a run that ends on a signal stops
// its servers and removes its directory.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

import { startBoard, startPython } from '../../scripts/board-servers.mts';
import { jsonString, parseJsonObject } from '../../scripts/json.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// An application directory with a PHP entry, a static deployment and a comparison page.
function application(t: TestContext): string {
  const app = mkdtempSync(path.join(tmpdir(), 'hyper-board-servers-'));
  t.after(() => rmSync(app, { recursive: true, force: true }));
  mkdirSync(path.join(app, 'public'));
  mkdirSync(path.join(app, 'build', 'csr'), { recursive: true });
  writeFileSync(path.join(app, 'public', 'index.php'), '<?php echo "ok";\n');
  writeFileSync(path.join(app, 'build', 'csr', 'index.html'), '<!doctype html>\n');
  writeFileSync(path.join(app, 'compare.html'), '<!doctype html>\n');
  return app;
}

// The port of a listening server.
function portOf(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error(`the server listens on ${address ?? 'no address'}, not on a TCP port`);
  return address.port;
}

// Whether the cause of a failed fetch is a refused connection.
const refused = (error: unknown): boolean => error instanceof Error && error.cause instanceof Error && 'code' in error.cause && error.cause.code === 'ECONNREFUSED';

const exited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;

test('a board whose server fails to start stops the servers that started before the start rejects', async (t) => {
  const app = application(t);
  // A server of another run holds the port of the SSR origin, so its PHP server exits.
  const holder = createServer((request, response) => response.end());
  await new Promise<void>((resolve) => holder.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => holder.close((error) => (error ? reject(error) : resolve()))));
  const children: ChildProcess[] = [];
  const cwd = process.cwd();
  process.chdir(ROOT);
  t.after(() => process.chdir(cwd));
  await assert.rejects(startBoard({ app, database: path.join(app, 'board.db'), ports: { api: 0, edge: 0, ssr: portOf(holder) }, children }), /start ssr: the server exited with \d+ before it reported its address/);
  assert.equal(children.length, 3);
  assert.deepEqual(children.map(exited), [true, true, true]);
});

test('a run that ends on SIGTERM stops its servers and removes its directory', async (t) => {
  const app = application(t);
  const script = `
    import { serverRun, startPhp } from ${JSON.stringify(path.join(ROOT, 'scripts/board-servers.mts'))};
    const run = serverRun('hyper-board-servers-run-');
    const php = await startPhp({ name: 'php', app: ${JSON.stringify(app)}, port: 0, env: {}, children: run.children });
    console.log(JSON.stringify({ directory: run.directory, url: php.url }));
    setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const started = new Promise<{ directory: string; url: string }>((resolve) => child.stdout.on('data', (data: Buffer) => {
    output += data.toString();
    const line = output.split('\n').find((text) => text.startsWith('{'));
    if (line) {
      const started = parseJsonObject(line, 'the output of the run');
      resolve({ directory: jsonString(started.directory, 'directory'), url: jsonString(started.url, 'url') });
    }
  }));
  const ended = new Promise<number | null>((resolve) => child.on('close', (code) => resolve(code)));
  const { directory, url } = await started;
  assert.equal((await fetch(url)).status, 200);
  child.kill('SIGTERM');
  assert.equal(await ended, 143);
  assert.equal(existsSync(directory), false);
  await assert.rejects(fetch(url, { signal: AbortSignal.timeout(2000) }), refused);
});

test('a server start that waits prints its progress with the line it waits for and the last line of the server (HY-89)', async () => {
  const script = `
    import { serverRun, startServer } from ${JSON.stringify(path.join(ROOT, 'scripts/board-servers.mts'))};
    const run = serverRun('hyper-board-servers-slow-');
    startServer({ name: 'slow', command: process.execPath, args: ['-e', "console.log('warming up'); setInterval(() => {}, 1000)"], env: process.env, ready: /^ready (\\S+)$/, children: run.children, progressMs: 100 });`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const ended = new Promise<number | null>((resolve) => child.on('close', (code) => resolve(code)));
  await new Promise<void>((resolve) => child.stdout.on('data', (data: Buffer) => {
    output += data.toString();
    if (/^… start slow waits.*printed 1 lines/m.test(output)) resolve();
  }));
  child.kill('SIGTERM');
  assert.equal(await ended, 143);
  assert.match(output, /^\[slow\] warming up$/m);
  assert.match(output, /^… start slow waits for a line that matches \/\^ready \(\\S\+\)\$\/ \(\d+ ms\); the server printed 1 lines, the last: warming up$/m);
});

test('the board Python server starts with the Python that make exports in HYPER_PYTHON, and without it fails', (t) => {
  const exported = process.env['HYPER_PYTHON'];
  t.after(() => { if (exported === undefined) delete process.env['HYPER_PYTHON']; else process.env['HYPER_PYTHON'] = exported; });
  delete process.env['HYPER_PYTHON'];
  assert.throws(() => startPython({ name: 'python', app: 'examples/board', port: 0, env: {}, children: [] }), /HYPER_PYTHON is not set/);
});
