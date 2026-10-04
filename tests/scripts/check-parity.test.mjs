// Tests that scripts/check-parity.mjs prints every step when it starts and fails by the step name when the
// server does not answer the request of that step. Needs the browser package build of `make packages`.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const MANIFEST = {
  layout: 'layout.tpl',
  title: 'title.tpl',
  regions: [{ name: 'content', page: true }],
  routes: [{ name: 'home', path: '/', title: 'Home', template: 'home.tpl' }, { name: 'slow', path: '/slow', title: 'Slow', template: 'home.tpl' }],
};

test('a step whose request gets no answer fails by its name with the elapsed time', async () => {
  const app = mkdtempSync(join(tmpdir(), 'hyper-parity-'));
  // The server answers the start probe and the first request and never answers /slow.
  const server = createServer((request, response) => {
    if (request.url === '/slow') return;
    response.writeHead(request.url === '/' ? 200 : 404, { 'Content-Type': 'text/plain' }).end('');
  });
  try {
    for (const directory of ['app', 'build', 'public']) mkdirSync(join(app, directory));
    writeFileSync(join(app, 'app', 'app.json'), JSON.stringify(MANIFEST));
    writeFileSync(join(app, 'build', 'templates.index.json'), '{}');
    writeFileSync(join(app, 'requests.json'), JSON.stringify({ steps: [{ action: 'send', method: 'GET', path: '/' }, { action: 'compare', method: 'GET', path: '/slow', currentPath: '/' }] }));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    // PHP cannot listen on the port of this server, so the check sends its requests to this server.
    const child = spawn(process.execPath, ['scripts/check-parity.mjs', '--app', app, '--requests', join(app, 'requests.json'), '--port', String(server.address().port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { output += data; });
    const started = Date.now();
    const status = await new Promise((resolve) => {
      const limit = setTimeout(() => { child.kill('SIGKILL'); resolve('killed'); }, 20_000);
      child.on('close', (code) => { clearTimeout(limit); resolve(code); });
    });
    assert.notEqual(status, 'killed', `The check did not end within 20 s:\n${output}`);
    assert.equal(status, 1, output);
    assert.ok(Date.now() - started < 20_000);
    assert.match(output, /^▶ send GET \/$/m);
    assert.match(output, /^ok send GET \/: 200 \(\d+ ms\)$/m);
    assert.match(output, /^▶ compare GET \/slow$/m);
    assert.match(output, /^FAIL compare GET \/slow: GET \/slow to http:\/\/127\.0\.0\.1:\d+ got no response within 10000 ms \(\d+ ms\)$/m);
  } finally {
    server.closeAllConnections();
    server.close();
    rmSync(app, { recursive: true, force: true });
  }
});
