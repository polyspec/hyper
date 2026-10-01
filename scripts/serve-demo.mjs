// Starts the board example in both rendering modes on one database:
//   SSR  http://127.0.0.1:<ssr>      PHP renders documents and answers JSON at the root
//   API  http://127.0.0.1:<api>/api  PHP answers JSON under /api (the CSR data origin)
//   CSR  http://127.0.0.1:<edge>     the edge serves the static shell and forwards /api
//   compare http://127.0.0.1:<edge>/compare?ssr=http://127.0.0.1:<ssr>
//
// Usage: node scripts/serve-demo.mjs --db examples/board/var/demo.db --ssr 8080 --edge 8081 --api 8082

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { db: { type: 'string' }, ssr: { type: 'string' }, edge: { type: 'string' }, api: { type: 'string' } } });
for (const name of ['db', 'ssr', 'edge', 'api']) {
  if (!values[name]) throw new Error(`--${name} is required`);
}
const board = 'examples/board';
const database = resolve(values.db);

const children = [
  spawn('php', ['-S', `127.0.0.1:${values.ssr}`, '-t', `${board}/public`], {
    env: { ...process.env, BOARD_DB: database, BOARD_BASE_PATH: '' },
    stdio: 'ignore',
  }),
  spawn('php', ['-S', `127.0.0.1:${values.api}`, '-t', `${board}/public`], {
    env: { ...process.env, BOARD_DB: database, BOARD_BASE_PATH: '/api' },
    stdio: 'ignore',
  }),
  spawn(process.execPath, [
    'scripts/serve-edge.mjs',
    '--shell', `${board}/dist/csr/index.html`,
    '--compare', `${board}/compare.html`,
    '--port', values.edge,
    '--api-prefix', '/api',
    '--api-origin', `http://127.0.0.1:${values.api}`,
  ], { stdio: 'inherit' }),
];
console.log(`SSR http://127.0.0.1:${values.ssr}/board`);
console.log(`CSR http://127.0.0.1:${values.edge}/board`);
console.log(`compare http://127.0.0.1:${values.edge}/compare?ssr=http://127.0.0.1:${values.ssr}`);

const stop = () => {
  for (const child of children) child.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) child.on('exit', (code) => { if (code) stop(); });
