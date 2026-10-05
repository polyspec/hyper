// Tests that `make e2e` runs the browser tests on servers of its own run (scripts/run-e2e.mjs): the servers listen on
// ports that the system assigns while another server holds a port of an earlier run, Playwright receives their
// addresses, and the database of the run is removed with its temporary directory. The test lists the cases and
// runs none of them.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { test } from 'node:test';

test('the browser tests run on servers of the run while another server holds a port of an earlier run', async (t) => {
  // A server of another run answers every request with 500 on 127.0.0.1:8091, the edge port of an earlier run.
  const foreign = createServer((request, response) => response.writeHead(500).end('foreign server'));
  const held = await new Promise((resolve, reject) => {
    foreign.once('error', (error) => (error.code === 'EADDRINUSE' ? resolve(false) : reject(error)));
    foreign.listen(8091, '127.0.0.1', () => resolve(true));
  });
  t.after(() => new Promise((resolve) => (held ? foreign.close(resolve) : resolve())));
  const child = spawn(process.execPath, ['scripts/run-e2e.mjs', '--list'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  const status = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(status, 0, output);
  for (const name of ['api', 'ssr']) assert.match(output, new RegExp(`^\\[${name}\\] .*Development Server \\(http://127\\.0\\.0\\.1:\\d+\\) started$`, 'm'));
  assert.match(output, /^\[edge\] edge http:\/\/127\.0\.0\.1:\d+ \(\/api -> http:\/\/127\.0\.0\.1:\d+\)$/m);
  assert.match(output, /Total: \d+ tests? in 1 file/);
  assert.doesNotMatch(output, /127\.0\.0\.1:(8090|8091|8093)\b/);
  const run = /^run directory: (\S+)$/m.exec(output)?.[1];
  assert.ok(run !== undefined, output);
  assert.equal(existsSync(run), false);
});

test('Playwright without the runner fails and names the missing address', () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('HYPER_E2E_')));
  const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--list'], { env, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /HYPER_E2E_SSR is required; run the browser tests with make e2e/);
});
