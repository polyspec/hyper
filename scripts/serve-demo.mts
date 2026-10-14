// Starts the board example in both rendering modes on one database for interactive development:
//   SSR  http://127.0.0.1:<ssr>      PHP renders documents and answers JSON at the root
//   API  http://127.0.0.1:<api>/api  PHP answers JSON under /api (the CSR data origin)
//   CSR  http://127.0.0.1:<edge>     the edge serves the static shell and forwards /api
//   compare http://127.0.0.1:<edge>/compare?ssr=http://127.0.0.1:<ssr>
//
// The ports are fixed so that the addresses stay the same between sessions, so the demo exists once: it holds the
// lock --lock of the holder-lock tool of @polyspec/kit while it runs, and a second demo fails with the checkout, the process ID and
// the start time of the first. A lock of an ended demo is reported and stays until `make serve-demo-unlock` removes
// it. The servers start with scripts/board-servers.mts, which prints their output; SIGINT and SIGTERM stop them.
//
// Usage: node scripts/serve-demo.mts --db examples/board/var/board.db --ssr 8080 --edge 8081 --api 8082
//          --lock /tmp/hyper-serve-demo.lock
import type { ChildProcess } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { startBoard, stopServers } from './board-servers.mts';
import { acquireHolderLock } from '@polyspec/kit/holder-lock';

const { values } = parseArgs({ options: { db: { type: 'string' }, ssr: { type: 'string' }, edge: { type: 'string' }, api: { type: 'string' }, lock: { type: 'string' } } });
const required = (name: keyof typeof values): string => {
  const value = values[name];
  if (!value) throw new Error(`--${name} is required`);
  return value;
};
const [db, ssr, edge, api, lock] = [required('db'), required('ssr'), required('edge'), required('api'), required('lock')];

const children: ChildProcess[] = [];
let stopping = false;
// Stops the servers once and exits; the exit releases the lock. A failure to stop them is reported and exits with 1.
const stop = (code: number): void => {
  if (stopping) return;
  stopping = true;
  stopServers(children).then(
    () => process.exit(code),
    (error: unknown) => {
      console.error(`the servers did not stop: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
};
// A signal during the start stops the servers that have started too.
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
try {
  // The demo stops its servers on SIGINT and SIGTERM and then exits, and the exit releases the lock, so the lock installs no
  // signal handler that would end the process before the servers stop.
  acquireHolderLock(resolve(lock), { checkout: resolve(dirname(fileURLToPath(import.meta.url)), '..'), releaseOnSignals: false });
  console.log(`holding ${lock}`);
  const board = await startBoard({ app: 'examples/board', database: resolve(db), ports: { ssr: Number(ssr), edge: Number(edge), api: Number(api) }, children });
  console.log(`SSR ${board.ssr}/board`);
  console.log(`CSR ${board.edge}/board`);
  console.log(`compare ${board.edge}/compare?ssr=${board.ssr}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
for (const child of children) {
  child.on('exit', (code, signal) => {
    console.error(`a server exited ${signal ? `on ${signal}` : `with ${code}`}; stopping the demo`);
    stop(1);
  });
}
