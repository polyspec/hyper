// Serves a client-side rendering deployment the way the CDN in front of it does: requests under the
// API prefix go to the API origin unchanged, `/compare` returns the comparison page, a path of a file
// in the deployment directory returns that file, and every other path returns index.html.
//
// It prints `edge http://127.0.0.1:<port> (...)` with the port that it listens on, also when --port 0 lets the
// system assign the port.
//
// Usage: node scripts/serve-edge.mts --root examples/board/dist/csr --compare examples/board/compare.html
//          --port 8081 --api-prefix /api --api-origin http://127.0.0.1:8082

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { createServer, request } from 'node:http';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    compare: { type: 'string' },
    port: { type: 'string' },
    'api-prefix': { type: 'string' },
    'api-origin': { type: 'string' },
  },
});
const { root, compare, port, 'api-prefix': prefix, 'api-origin': apiOrigin } = values;
for (const [name, value] of Object.entries({ root, compare, port, 'api-prefix': prefix, 'api-origin': apiOrigin })) {
  if (!value) throw new Error(`--${name} is required`);
}
if (!root || !compare || !port || !prefix || !apiOrigin) throw new Error('--root, --compare, --port, --api-prefix and --api-origin are required');
const CONTENT_TYPES: Record<string, string> = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.html': 'text/html; charset=utf-8' };
const api = new URL(apiOrigin);

const server = createServer((incoming, outgoing) => {
  const path = new URL(incoming.url ?? '/', 'http://edge.invalid').pathname;
  if (path === prefix || path.startsWith(`${prefix}/`)) {
    const proxied = request(
      { hostname: api.hostname, port: api.port, method: incoming.method, path: incoming.url, headers: { ...incoming.headers, host: api.host } },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    proxied.on('error', (error) => {
      outgoing.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      outgoing.end(`API origin error: ${error.message}`);
    });
    incoming.pipe(proxied);
    return;
  }
  if (path === '/compare') {
    outgoing.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    outgoing.end(readFileSync(compare));
    return;
  }
  const file = join(root, normalize(path).replace(/^([.][.][/\\])+/, ''));
  if (path !== '/' && existsSync(file) && statSync(file).isFile()) {
    // Template files and chunk files carry a content hash in their names and never change; the stylesheets and the shell
    // change with every deployment (docs/operations/deployment.md). A chunk is a module script, which the browser runs
    // only with a JavaScript media type (HY-76).
    const hashed = path.startsWith('/assets/templates/') || /^\/assets\/hyper-chunk-[A-Z0-9]+\.js$/.test(path);
    const cache = hashed ? 'public, max-age=31536000, immutable' : 'no-cache';
    outgoing.writeHead(200, { 'Content-Type': CONTENT_TYPES[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream', 'Cache-Control': cache });
    outgoing.end(readFileSync(file));
    return;
  }
  outgoing.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  outgoing.end(readFileSync(join(root, 'index.html')));
});
server.listen(Number(port), '127.0.0.1', () => {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error(`the edge server listens on no TCP port: ${String(address)}`);
  console.log(`edge http://127.0.0.1:${address.port} (${prefix} -> ${api.origin})`);
});
