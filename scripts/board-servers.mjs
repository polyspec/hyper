// Starts the servers of a run of the board example: the PHP server, the board Node server and the edge of
// scripts/serve-edge.mjs. Each server listens on the port that the caller gives, or on a port that the system
// assigns when the caller gives 0, and the run learns its address from the line in which that server reports that
// it listens; a request therefore reaches the server that this run started and never a server of another run.
// Starting a server is a step without a time limit: it prints its start, every output line of the server with the
// prefix [<name>] and its result with the elapsed time, ends when the server reports its address and fails when the
// server exits first.
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';

const PHP_READY = /Development Server \((http:\/\/127\.0\.0\.1:\d+)\) started/;
const NODE_READY = /^board on (http:\/\/127\.0\.0\.1:\d+)$/m;
const EDGE_READY = /^edge (http:\/\/127\.0\.0\.1:\d+) /m;

/**
 * Starts a server process and resolves { child, url } once a line of its output matches `ready`, whose first group
 * is the address of the server; rejects when the process exits or fails to start first.
 */
export function startServer({ name, command, args, env, ready }) {
  const step = `start ${name}`;
  process.stdout.write(`▶ ${step}\n`);
  const started = performance.now();
  const elapsed = () => `${Math.round(performance.now() - started)} ms`;
  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
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
export function startPhp({ name, app, port, env, extension }) {
  const loaded = extension ? ['-d', `extension=${resolve(extension)}`] : [];
  return startServer({
    name,
    command: 'php',
    args: [...loaded, '-d', 'display_errors=0', '-S', `127.0.0.1:${port}`, '-t', join(app, 'public')],
    env: { ...process.env, ...env },
    ready: PHP_READY,
  });
}

/** Starts the board Node server of `make node-server` on `port`. */
export function startNode({ name, app, port, env }) {
  return startServer({
    name,
    command: process.execPath,
    args: [join(app, 'build', 'node', 'server.mjs')],
    env: { ...process.env, ...env, BOARD_PORT: String(port) },
    ready: NODE_READY,
  });
}

/** Starts the edge of scripts/serve-edge.mjs on `port`, which forwards /api to `api`. */
export function startEdge({ name, app, port, api }) {
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
  });
}

/**
 * Starts the board example in both rendering modes on the database `database`: the API origin (PHP under /api), the
 * edge that serves the static shell and forwards /api to it, and the SSR origin (PHP at the root), whose pages the
 * comparison page of the edge frames. `ports` gives the port of each server, 0 for a port that the system assigns.
 * Resolves { ssr, edge, api, children }.
 */
export async function startBoard({ app, database, ports }) {
  const children = [];
  try {
    const api = await startPhp({ name: 'api', app, port: ports.api, env: { BOARD_DB: database, BOARD_BASE_PATH: '/api' } });
    children.push(api.child);
    const edge = await startEdge({ name: 'edge', app, port: ports.edge, api: api.url });
    children.push(edge.child);
    const ssr = await startPhp({ name: 'ssr', app, port: ports.ssr, env: { BOARD_DB: database, BOARD_BASE_PATH: '', BOARD_FRAME_ANCESTORS: `'self' ${edge.url}` } });
    children.push(ssr.child);
    return { ssr: ssr.url, edge: edge.url, api: api.url, children };
  } catch (error) {
    stopServers(children);
    throw error;
  }
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
