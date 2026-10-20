// Tests that scripts/check-parity.mts tests the servers of its own run: it starts the PHP server on a port that the
// system assigns, sends its requests to the address that the server reports, prints the output of the server, keeps
// its database in a temporary directory of the run, prints every step when it starts and fails by the step name when
// the server does not answer the request of that step. Needs the browser package build of `make packages`.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { requireBuilt } from './requires.mts';

requireBuilt('packages', 'node_modules/@polyspec/hyper-client/dist/index.js');

const MANIFEST = {
  layout: 'layout.tpl',
  title: 'title.tpl',
  regions: [{ name: 'content', page: true }],
  routes: [{ name: 'home', path: '/', title: 'Home', template: 'home.tpl' }, { name: 'slow', path: '/slow', title: 'Slow', template: 'home.tpl' }],
};
// The PHP server of the fixture answers / with 200, never answers /slow and answers every other path with 404.
const INDEX = `<?php
if ($_SERVER['REQUEST_URI'] === '/slow') {
    sleep(3600);
}
http_response_code($_SERVER['REQUEST_URI'] === '/' ? 200 : 404);
header('Content-Type: text/plain');
`;

// A step of requests.json.
type Step = Record<string, string | number>;
// Acts on the check once its output holds `text`.
interface WhenOutput { text: string; act: (child: ChildProcess, output: string) => void }

// Whether the cause of a failed fetch is a refused connection.
const refused = (error: unknown): boolean => error instanceof Error && error.cause instanceof Error && 'code' in error.cause && error.cause.code === 'ECONNREFUSED';

function fixture(t: TestContext, steps: Step[]): string {
  const app = mkdtempSync(join(tmpdir(), 'hyper-parity-app-'));
  t.after(() => rmSync(app, { recursive: true, force: true }));
  for (const directory of ['app', 'build', 'public']) mkdirSync(join(app, directory));
  writeFileSync(join(app, 'app', 'app.json'), JSON.stringify(MANIFEST));
  writeFileSync(join(app, 'build', 'templates.index.json'), '{}');
  writeFileSync(join(app, 'public', 'index.php'), INDEX);
  writeFileSync(join(app, 'requests.json'), JSON.stringify({ steps }));
  return app;
}

// Runs the check in a process group of its own and resolves its exit status and output; when it has not ended within
// 20 s the whole group is killed, so its servers end with it (HR-87). `whenOutput(text, act)` acts once the output
// holds `text`.
async function check(app: string, { whenOutput }: { whenOutput?: WhenOutput } = {}): Promise<{ status: number | NodeJS.Signals | 'killed' | null; output: string }> {
  const child = spawn(process.execPath, ['scripts/check-parity.mts', '--app', app, '--requests', join(app, 'requests.json')], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const pid = child.pid;
  if (pid === undefined) throw new Error('scripts/check-parity.mts did not start');
  let output = '';
  let acted = false;
  const read = (data: Buffer) => {
    output += data.toString();
    if (whenOutput && !acted && output.includes(whenOutput.text)) {
      acted = true;
      whenOutput.act(child, output);
    }
  };
  child.stdout.on('data', read);
  child.stderr.on('data', read);
  const status = await new Promise<number | NodeJS.Signals | 'killed' | null>((resolve) => {
    const limit = setTimeout(() => { process.kill(-pid, 'SIGKILL'); resolve('killed'); }, 20_000);
    child.on('close', (code, signal) => { clearTimeout(limit); resolve(code ?? signal); });
  });
  assert.notEqual(status, 'killed', `The check did not end within 20 s:\n${output}`);
  return { status, output };
}

test('a step whose request gets no answer fails by its name with the elapsed time', async (t) => {
  const app = fixture(t, [{ action: 'send', method: 'GET', path: '/' }, { action: 'compare', method: 'GET', path: '/slow', currentPath: '/' }]);
  const { status, output } = await check(app);
  assert.equal(status, 1, output);
  const url = /^\[php\] .*Development Server \((http:\/\/127\.0\.0\.1:\d+)\) started$/m.exec(output)?.[1];
  assert.ok(url !== undefined, output);
  assert.match(output, /^ok start php: http:\/\/127\.0\.0\.1:\d+ \(\d+ ms\)$/m);
  assert.match(output, /^▶ send GET \/$/m);
  assert.match(output, /^ok send GET \/: 200 \(\d+ ms\)$/m);
  assert.match(output, /^▶ compare GET \/slow$/m);
  assert.ok(output.includes(`FAIL compare GET /slow: GET /slow to ${url} got no response within 10000 ms (`), output);
});

test('the check tests its own server while another server answers on the port of an earlier run', async (t) => {
  // A server of another run answers every request with 500 on 127.0.0.1:8092, the port that the check used before.
  const foreign = createServer((request, response) => response.writeHead(500).end('foreign server'));
  const held = await new Promise<boolean>((resolve, reject) => {
    foreign.once('error', (error) => ('code' in error && error.code === 'EADDRINUSE' ? resolve(false) : reject(error)));
    foreign.listen(8092, '127.0.0.1', () => resolve(true));
  });
  t.after(() => new Promise<void>((resolve) => (held ? foreign.close(() => resolve()) : resolve())));
  const app = fixture(t, [{ action: 'send', method: 'GET', path: '/' }, { action: 'status', method: 'GET', path: '/missing', status: 404 }]);
  const { status, output } = await check(app);
  assert.equal(status, 0, output);
  assert.match(output, /^ok send GET \/: 200 \(\d+ ms\)$/m);
  assert.match(output, /^ok status GET \/missing: 404, browser route none \(\d+ ms\)$/m);
  assert.doesNotMatch(output, /127\.0\.0\.1:8092/);
  // The database of the run lies in its run directory, which the check removes.
  const run = /^run directory: (\S+)$/m.exec(output)?.[1];
  assert.ok(run !== undefined, output);
  assert.equal(existsSync(run), false);
  assert.equal(existsSync(join(app, 'var')), false);
});

test('a request file without a status or a compare step fails before any server starts (HR-84)', async (t) => {
  const app = fixture(t, [{ action: 'send', method: 'GET', path: '/' }]);
  const { status, output } = await check(app);
  assert.equal(status, 1, output);
  assert.match(output, /requests\.json holds no status or compare step; expected at least 1, actual 0 of 1 steps/);
  assert.doesNotMatch(output, /start php/);
});

test('a check that receives SIGTERM stops its server and removes its run directory before it ends (HR-87)', async (t) => {
  const app = fixture(t, [{ action: 'send', method: 'GET', path: '/' }, { action: 'compare', method: 'GET', path: '/slow', currentPath: '/' }]);
  const { status, output } = await check(app, { whenOutput: { text: '▶ compare GET /slow', act: (child) => child.kill('SIGTERM') } });
  assert.equal(status, 143, output);
  const url = /^ok start php: (http:\/\/127\.0\.0\.1:\d+) /m.exec(output)?.[1];
  const run = /^run directory: (\S+)$/m.exec(output)?.[1];
  assert.ok(url && run, output);
  assert.match(output, /SIGTERM: stopping 1 servers and removing /);
  assert.equal(existsSync(run), false);
  await assert.rejects(fetch(url, { signal: AbortSignal.timeout(2000) }), refused, 'the PHP server of the check still answers');
});
