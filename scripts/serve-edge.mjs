// Serves a client-side rendering deployment the way the CDN in front of it does: requests under the
// API prefix go to the API origin unchanged, `/compare` returns the comparison page, a path of a file
// in the deployment directory returns that file, and every other path returns index.html.
//
// Usage: node scripts/serve-edge.mjs --root examples/board/dist/csr --compare examples/board/compare.html
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
for (const name of ['root', 'compare', 'port', 'api-prefix', 'api-origin']) {
  if (!values[name]) throw new Error(`--${name} is required`);
}
const prefix = values['api-prefix'];
const CONTENT_TYPES = { '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.html': 'text/html; charset=utf-8' };
const api = new URL(values['api-origin']);

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
    outgoing.end(readFileSync(values.compare));
    return;
  }
  const file = join(values.root, normalize(path).replace(/^([.][.][/\\])+/, ''));
  if (path !== '/' && existsSync(file) && statSync(file).isFile()) {
    // Template files carry a content hash in their names and never change; the stylesheets and the shell change with every deployment.
    const cache = path.startsWith('/assets/templates/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    outgoing.writeHead(200, { 'Content-Type': CONTENT_TYPES[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream', 'Cache-Control': cache });
    outgoing.end(readFileSync(file));
    return;
  }
  outgoing.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  outgoing.end(readFileSync(join(values.root, 'index.html')));
});
server.listen(Number(values.port), '127.0.0.1', () => {
  console.log(`edge http://127.0.0.1:${values.port} (${prefix} -> ${api.origin})`);
});
