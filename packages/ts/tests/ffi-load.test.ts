// The first load of node:ffi in a process emits an ExperimentalWarning of the runtime. The file sessions load the module
// when the application constructs FileSessions, which is before the server answers a request, so the warnings guard of
// a request (HY-74) does not meet that warning in the first request that locks a session file (HY-104).
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FIXTURES, TEMPLATES } from './support.js';

const DIST = fileURLToPath(new URL('../dist/index.js', import.meta.url));
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
