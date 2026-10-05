// Starts the board example in both rendering modes on one database for interactive development:
//   SSR  http://127.0.0.1:<ssr>      PHP renders documents and answers JSON at the root
//   API  http://127.0.0.1:<api>/api  PHP answers JSON under /api (the CSR data origin)
//   CSR  http://127.0.0.1:<edge>     the edge serves the static shell and forwards /api
//   compare http://127.0.0.1:<edge>/compare?ssr=http://127.0.0.1:<ssr>
//
// The ports are fixed so that the addresses stay the same between sessions, so the demo exists once: it holds the
// lock --lock of scripts/holder-lock.mjs while it runs, and a second demo fails with the checkout, the process ID and
// the start time of the first. A lock of an ended demo is reported and stays until `make serve-demo-unlock` removes
// it. The servers start with scripts/board-servers.mjs, which prints their output; SIGINT and SIGTERM stop them.
//
// Usage: node scripts/serve-demo.mjs --db examples/board/var/board.db --ssr 8080 --edge 8081 --api 8082
//          --lock /tmp/hyper-serve-demo.lock
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { startBoard, stopServers } from './board-servers.mjs';
import { acquire } from './holder-lock.mjs';

const { values } = parseArgs({ options: { db: { type: 'string' }, ssr: { type: 'string' }, edge: { type: 'string' }, api: { type: 'string' }, lock: { type: 'string' } } });
for (const name of ['db', 'ssr', 'edge', 'api', 'lock']) {
  if (!values[name]) throw new Error(`--${name} is required`);
}

let children = [];
let stopping = false;
// Stops the servers once and exits; the exit releases the lock.
const stop = async (code) => {
  if (stopping) return;
  stopping = true;
  await stopServers(children);
  process.exit(code);
};
try {
  acquire(values.lock, resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  console.log(`holding ${values.lock}`);
  const board = await startBoard({ app: 'examples/board', database: resolve(values.db), ports: { ssr: Number(values.ssr), edge: Number(values.edge), api: Number(values.api) } });
  children = board.children;
  console.log(`SSR ${board.ssr}/board`);
  console.log(`CSR ${board.edge}/board`);
  console.log(`compare ${board.edge}/compare?ssr=${board.ssr}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
for (const child of children) {
  child.on('exit', (code, signal) => {
    console.error(`a server exited ${signal ? `on ${signal}` : `with ${code}`}; stopping the demo`);
    stop(1);
  });
}
