// Runs the browser tests of `make e2e` on servers of this run: it starts the board example in both rendering modes
// with scripts/board-servers.mjs on ports that the system assigns and an empty database in a temporary directory of
// the run, runs Playwright with the addresses in HYPER_E2E_SSR and HYPER_E2E_CSR, and then stops the servers and
// removes the directory. Starting the servers is a step without a time limit; every case of Playwright keeps its own
// timeout. The arguments are passed to `playwright test`.
//
// Usage: node scripts/run-e2e.mjs [<playwright test arguments>...]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startBoard, stopServers } from './board-servers.mjs';

const run = mkdtempSync(join(tmpdir(), 'hyper-e2e-'));
console.log(`run directory: ${run}`);
let children = [];
try {
  const board = await startBoard({ app: 'examples/board', database: join(run, 'board.db'), ports: { ssr: 0, edge: 0, api: 0 } });
  children = board.children;
  // npm installs no bin links (HY-79), so the runner starts the command line entry of Playwright with node.
  const playwright = spawn(process.execPath, [resolve('node_modules/@playwright/test/cli.js'), 'test', ...process.argv.slice(2)], {
    env: { ...process.env, HYPER_E2E_SSR: board.ssr, HYPER_E2E_CSR: board.edge },
    stdio: 'inherit',
  });
  const { code, signal } = await new Promise((resolvePromise, reject) => {
    playwright.on('error', reject);
    playwright.on('close', (code, signal) => resolvePromise({ code, signal }));
  });
  if (signal) console.error(`playwright ended on ${signal}`);
  process.exitCode = code ?? 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await stopServers(children);
  rmSync(run, { recursive: true, force: true });
}
