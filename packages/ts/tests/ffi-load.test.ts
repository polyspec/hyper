// The first load of node:ffi in a process emits an ExperimentalWarning of the runtime. The file sessions load the module
// when the application constructs FileSessions, which is usually before the server answers a request, so the warnings
// guard of a request (HY-74) does not meet that warning in the first request that locks a session file (HY-104). The
// load is the server's own, so it runs outside of the guard also when the application constructs its first
// FileSessions while a request is answered.
import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FIXTURES, TEMPLATES } from './support.js';

const DIST = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const SOURCES = fileURLToPath(new URL('../src/', import.meta.url));
const IDENTIFIER = 'a'.repeat(32);

// A server process of its own: the warning is emitted once per process, so the process of the test runner, in which
// another test may have loaded the module, shows nothing. The process prints what happened in its order.
const SERVER = `
import { App, FileSessions } from ${JSON.stringify(pathToFileURL(DIST).href)};
const [directory, manifest, build, index, root] = process.argv.slice(1);
const events = [];
process.on('warning', (warning) => events.push(warning.name + ': ' + warning.message));
const rows = { regions: { rows: () => ({ items: [], open: false, mode: 'a', view: 'x', filter: { a: 1 }, tags: [] }) } };
const app = await App.open({
  manifest,
  build,
  templates: { index, root },
  handlers: {
    regions: { side: ({ request }) => ({ count: 0, note: request.flash('note') }) },
    routes: { home: { load: () => ({ name: 'n0' }) }, add: { post: () => ({}) }, list: rows, item: { load: () => ({ id: '' }) } },
  },
  timezone: '+09:00',
  log: (message) => events.push('log: ' + message),
});
const server = app.server(new FileSessions({ directory }));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
events.push('listening');
const response = await fetch('http://127.0.0.1:' + String(server.address().port) + '/', { headers: { Cookie: 'hy-session=${IDENTIFIER}' } });
await response.arrayBuffer();
events.push('answered ' + String(response.status));
await new Promise((resolve) => server.close(resolve));
process.stdout.write(JSON.stringify(events));
`;

// A server process whose application constructs its first FileSessions while a request is answered, in the load of the
// route home, and whose route item emits a warning of its own. The server keeps its sessions in a Redis store whose
// command answers nothing, so the load of the route is the first use of node:ffi in the process.
const HANDLER = `
import { App, FileSessions, RedisSessions } from ${JSON.stringify(pathToFileURL(DIST).href)};
const [directory, manifest, build, index, root] = process.argv.slice(1);
const events = [];
process.on('warning', (warning) => events.push(warning.name + ': ' + warning.message));
const rows = { regions: { rows: () => ({ items: [], open: false, mode: 'a', view: 'x', filter: { a: 1 }, tags: [] }) } };
const app = await App.open({
  manifest,
  build,
  templates: { index, root },
  handlers: {
    regions: { side: () => ({ count: 0, note: null }) },
    routes: {
      home: { load: () => { new FileSessions({ directory }); return { name: 'n0' }; } },
      add: { post: () => ({}) },
      list: rows,
      item: { load: () => { process.emitWarning('application'); return { id: '' }; } },
    },
  },
  timezone: '+09:00',
  log: (message) => events.push('log: ' + String(message).split('\\n')[0]),
});
const server = app.server(new RedisSessions({ command: async () => null }));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
events.push('listening');
for (const path of ['/', '/', '/items/1']) {
  const response = await fetch('http://127.0.0.1:' + String(server.address().port) + path);
  await response.arrayBuffer();
  events.push('answered ' + String(response.status));
}
await new Promise((resolve) => server.close(resolve));
process.stdout.write(JSON.stringify(events));
`;

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'hyper-ffi-load-'));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

it('loads node:ffi before the server answers, so the first request that locks a session file is answered (HY-74, HY-104)', async () => {
  // The file of the session that the cookie names: the request opens and locks it.
  writeFileSync(join(directory, `sess_${IDENTIFIER}`), 'a:0:{}');
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', SERVER, directory, `${FIXTURES}app.json`, `${FIXTURES}build.json`, TEMPLATES.index, TEMPLATES.root]);
  expect(JSON.parse(stdout)).toEqual(['ExperimentalWarning: FFI is an experimental feature and might change at any time', 'listening', 'answered 200']);
});

it('runs nothing but the load of node:ffi outside of the warnings guard (HY-74.9)', () => {
  // Every call of WarningsGuard.outside in the sources of the package, as its file and its line text.
  const calls = readdirSync(SOURCES, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts'))
    .sort()
    .flatMap((file) => readFileSync(join(SOURCES, file), 'utf8').split('\n').filter((line) => /\bWarningsGuard\s*\.\s*outside\b/.test(line)).map((line) => [file.split(sep).join('/'), line.trim()]));
  expect(calls).toEqual([['session/flock.ts', "const ffi: unknown = WarningsGuard.outside(() => process.getBuiltinModule('node:ffi'));"]]);
  // The guard is no interface of an application: the entry of the package does not export it.
  expect(readFileSync(join(SOURCES, 'index.ts'), 'utf8')).not.toMatch(/warnings-guard|WarningsGuard/);
});

it('answers the request in which the application constructs its first FileSessions, and still fails a request for a warning of the application (HY-74, HY-104)', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', HANDLER, directory, `${FIXTURES}app.json`, `${FIXTURES}build.json`, TEMPLATES.index, TEMPLATES.root]);
  // The warning of the server's own load of node:ffi is delivered as a warning and the request is answered; the
  // warning that the application emits in the third request is thrown at its call and the request fails (HY-74.9,
  // HY-74.10).
  expect(JSON.parse(stdout)).toEqual([
    'listening',
    'ExperimentalWarning: FFI is an experimental feature and might change at any time',
    'answered 200',
    'answered 200',
    'log: hyper: Error: application',
    'answered 500',
  ]);
});
