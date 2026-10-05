// Tests that the servers of a run never outlive it (HY-87, scripts/board-servers.mjs): when a server of the board
// fails to start, the servers that started have exited before the start rejects, and a run that ends on a signal stops
// its servers and removes its directory.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { startBoard } from '../../scripts/board-servers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// An application directory with a PHP entry, a static deployment and a comparison page.
function application(t) {
  const app = mkdtempSync(path.join(tmpdir(), 'hyper-board-servers-'));
  t.after(() => rmSync(app, { recursive: true, force: true }));
  mkdirSync(path.join(app, 'public'));
  mkdirSync(path.join(app, 'build', 'csr'), { recursive: true });
  writeFileSync(path.join(app, 'public', 'index.php'), '<?php echo "ok";\n');
  writeFileSync(path.join(app, 'build', 'csr', 'index.html'), '<!doctype html>\n');
  writeFileSync(path.join(app, 'compare.html'), '<!doctype html>\n');
  return app;
}

const exited = (child) => child.exitCode !== null || child.signalCode !== null;

test('a board whose server fails to start stops the servers that started before the start rejects', async (t) => {
  const app = application(t);
  // A server of another run holds the port of the SSR origin, so its PHP server exits.
  const holder = createServer((request, response) => response.end());
  await new Promise((resolve) => holder.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => holder.close(resolve)));
  const children = [];
  const cwd = process.cwd();
  process.chdir(ROOT);
  t.after(() => process.chdir(cwd));
  await assert.rejects(startBoard({ app, database: path.join(app, 'board.db'), ports: { api: 0, edge: 0, ssr: holder.address().port }, children }), /start ssr: the server exited with \d+ before it reported its address/);
  assert.equal(children.length, 3);
  assert.deepEqual(children.map(exited), [true, true, true]);
});

test('a run that ends on SIGTERM stops its servers and removes its directory', async (t) => {
  const app = application(t);
  const script = `
    import { serverRun, startPhp } from ${JSON.stringify(path.join(ROOT, 'scripts/board-servers.mjs'))};
    const run = serverRun('hyper-board-servers-run-');
    const php = await startPhp({ name: 'php', app: ${JSON.stringify(app)}, port: 0, env: {}, children: run.children });
    console.log(JSON.stringify({ directory: run.directory, url: php.url }));
    setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const started = new Promise((resolve) => child.stdout.on('data', (data) => {
    output += data;
    const line = output.split('\n').find((text) => text.startsWith('{'));
    if (line) resolve(JSON.parse(line));
  }));
  const ended = new Promise((resolve) => child.on('close', (code) => resolve(code)));
  const { directory, url } = await started;
  assert.equal((await fetch(url)).status, 200);
  child.kill('SIGTERM');
  assert.equal(await ended, 143);
  assert.equal(existsSync(directory), false);
  await assert.rejects(fetch(url, { signal: AbortSignal.timeout(2000) }), (error) => error.cause?.code === 'ECONNREFUSED');
});
