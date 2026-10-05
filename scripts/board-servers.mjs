// Starts the servers of a run of the board example: the PHP server, the board Node server and the edge of
// scripts/serve-edge.mjs. Each server listens on the port that the caller gives, or on a port that the system
// assigns when the caller gives 0, and the run learns its address from the line in which that server reports that
// it listens; a request therefore reaches the server that this run started and never a server of another run.
// Starting a server is a step without a time limit: it prints its start, every output line of the server with the
// prefix [<name>] and its result with the elapsed time, ends when the server reports its address and fails when the
// server exits first.
//
// A run owns its servers and its temporary directory (HY-87): `serverRun` creates the directory, every server joins
// the children of the run when it is spawned, before it reports its address, and `close` stops every child, waits
// until each has exited and then removes the directory. A run closes on its end, on its failure and on SIGINT and
// SIGTERM, so no server outlives the run and no server holds a file of a removed directory.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PHP_READY = /Development Server \((http:\/\/127\.0\.0\.1:\d+)\) started/;
const NODE_READY = /^board on (http:\/\/127\.0\.0\.1:\d+)$/m;
const EDGE_READY = /^edge (http:\/\/127\.0\.0\.1:\d+) /m;

/**
 * Starts a server process and resolves { child, url } once a line of its output matches `ready`, whose first group
 * is the address of the server; rejects when the process exits or fails to start first.
 */
export function startServer({ name, command, args, env, ready, children }) {
  const step = `start ${name}`;
  process.stdout.write(`▶ ${step}\n`);
  const started = performance.now();
  const elapsed = () => `${Math.round(performance.now() - started)} ms`;
  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  return new Promise((resolvePromise, reject) => {
    let url = null;
    let pending = '';
    const read = (data) => {
      pending += data;
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) {
        process.stdout.write(`[${name}] ${line}\n`);
        const match = url === null ? ready.exec(line) : null;
        if (match) {
          url = match[1];
          process.stdout.write(`ok ${step}: ${url} (${elapsed()})\n`);
          resolvePromise({ child, url });
        }
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('error', (error) => reject(new Error(`${step}: ${error.message}`)));
    child.on('exit', (code, signal) => {
      if (pending !== '') process.stdout.write(`[${name}] ${pending}\n`);
      if (url !== null) return;
      process.stdout.write(`FAIL ${step} (${elapsed()})\n`);
      reject(new Error(`${step}: the server exited ${signal ? `on ${signal}` : `with ${code}`} before it reported its address`));
    });
  });
}

/** Starts the PHP server of the application directory `app` on `port`; `extension` loads the native extension. */
export function startPhp({ name, app, port, env, extension, children }) {
  const loaded = extension ? ['-d', `extension=${resolve(extension)}`] : [];
  return startServer({
    name,
    command: 'php',
    args: [...loaded, '-d', 'display_errors=0', '-S', `127.0.0.1:${port}`, '-t', join(app, 'public')],
    env: { ...process.env, ...env },
    ready: PHP_READY,
    children,
  });
}

/** Starts the board Node server of `make node-server` on `port`. */
export function startNode({ name, app, port, env, children }) {
  return startServer({
    name,
    command: process.execPath,
    args: [join(app, 'build', 'node', 'server.mjs')],
    env: { ...process.env, ...env, BOARD_PORT: String(port) },
    ready: NODE_READY,
    children,
  });
}

/** Starts the edge of scripts/serve-edge.mjs on `port`, which forwards /api to `api`. */
export function startEdge({ name, app, port, api, children }) {
  return startServer({
    name,
    command: process.execPath,
    args: [
      'scripts/serve-edge.mjs',
      '--root', join(app, 'build', 'csr'),
      '--compare', join(app, 'compare.html'),
      '--port', String(port),
      '--api-prefix', '/api',
      '--api-origin', api,
    ],
    env: process.env,
    ready: EDGE_READY,
    children,
  });
}

/**
 * Starts the board example in both rendering modes on the database `database`: the API origin (PHP under /api), the
 * edge that serves the static shell and forwards /api to it, and the SSR origin (PHP at the root), whose pages the
 * comparison page of the edge frames. `ports` gives the port of each server, 0 for a port that the system assigns;
 * every server joins `children` when it is spawned. When a server fails to start, the servers that started are
 * stopped and have exited before the returned promise rejects. Resolves { ssr, edge, api }.
 */
export async function startBoard({ app, database, ports, children }) {
  try {
    const api = await startPhp({ name: 'api', app, port: ports.api, env: { BOARD_DB: database, BOARD_BASE_PATH: '/api' }, children });
    const edge = await startEdge({ name: 'edge', app, port: ports.edge, api: api.url, children });
    const ssr = await startPhp({ name: 'ssr', app, port: ports.ssr, env: { BOARD_DB: database, BOARD_BASE_PATH: '', BOARD_FRAME_ANCESTORS: `'self' ${edge.url}` }, children });
    return { ssr: ssr.url, edge: edge.url, api: api.url };
  } catch (error) {
    await stopServers(children);
    throw error;
  }
}

/**
 * The resources of one run: a temporary directory named with `prefix` and the server children of the run. `close`
 * stops every child, waits until each has exited, removes the directory and is idempotent; SIGINT and SIGTERM close
 * the run and end the process with the status of the signal.
 */
export function serverRun(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  const children = [];
  let closing = null;
  const close = () => {
    closing ??= stopServers(children).then(() => rmSync(directory, { recursive: true, force: true }));
    return closing;
  };
  const onSignal = (signal) => {
    process.stderr.write(`${signal}: stopping ${children.length} servers and removing ${directory}\n`);
    close().then(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  return { directory, children, close };
}

/** Stops the server processes and resolves once every one has exited. */
export function stopServers(children) {
  return Promise.all(children.map((child) => new Promise((resolvePromise) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolvePromise();
      return;
    }
    child.once('exit', () => resolvePromise());
    child.kill();
  })));
}
