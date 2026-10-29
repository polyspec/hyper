// Runs the browser tests of `make e2e` on servers of this run: it starts the board example in both rendering modes
// with scripts/board-servers.mts on ports that the system assigns and an empty database in a temporary directory of
// the run, runs the command after `--` with the addresses in HYPER_E2E_SSR and HYPER_E2E_CSR, and then stops the servers
// and removes the directory. `make e2e` passes the Playwright run of the shared test runner, which reports each case and
// gives it its own timeout (H27.26). Starting the servers is a step without a time limit.
//
// Usage: node scripts/run-e2e.mts -- <command> [<arguments>...]
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { serverRun, startBoard } from './board-servers.mts';

const separator = process.argv.indexOf('--', 2);
const [command, ...args] = separator === 2 ? process.argv.slice(3) : [];
if (command === undefined) {
  console.error('Usage: node scripts/run-e2e.mts -- <command> [<arguments>...]');
  process.exit(2);
}

const run = serverRun('hyper-e2e-');
console.log(`run directory: ${run.directory}`);
try {
  const board = await startBoard({ app: 'examples/board', database: join(run.directory, 'board.db'), ports: { ssr: 0, edge: 0, api: 0 }, children: run.children });
  const tests = spawn(command, args, {
    env: { ...process.env, HYPER_E2E_SSR: board.ssr, HYPER_E2E_CSR: board.edge },
    stdio: 'inherit',
  });
  const { code, signal } = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolvePromise, reject) => {
    tests.on('error', reject);
    tests.on('close', (code, signal) => resolvePromise({ code, signal }));
  });
  if (signal) console.error(`${command} ended on ${signal}`);
  process.exitCode = code ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await run.close();
}
