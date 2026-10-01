// Serves a client-side rendering deployment the way the CDN in front of it does: requests under the
// API prefix go to the API origin unchanged, `/compare` returns the comparison page, and every other
// path returns the single static shell (index.html).
//
// Usage: node scripts/serve-edge.mjs --shell examples/board/dist/csr/index.html --compare examples/board/compare.html
//          --port 8081 --api-prefix /api --api-origin http://127.0.0.1:8082

import { readFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    shell: { type: 'string' },
    compare: { type: 'string' },
    port: { type: 'string' },
    'api-prefix': { type: 'string' },
    'api-origin': { type: 'string' },
  },
});
for (const name of ['shell', 'compare', 'port', 'api-prefix', 'api-origin']) {
  if (!values[name]) throw new Error(`--${name} is required`);
}
const prefix = values['api-prefix'];
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
  const file = path === '/compare' ? values.compare : values.shell;
  outgoing.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  outgoing.end(readFileSync(file));
});
server.listen(Number(values.port), '127.0.0.1', () => {
  console.log(`edge http://127.0.0.1:${values.port} (${prefix} -> ${api.origin})`);
});
