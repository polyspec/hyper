// Prints the sizes of the browser outputs of an application and fails when a gzip size exceeds its
// limit: the server-side rendering script and the client-side rendering shell.
//
// Usage: node scripts/check-bundle-size.mjs --app examples/board --limits config/bundle-size.json

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const { values } = parseArgs({ options: { app: { type: 'string' }, limits: { type: 'string' } } });
if (!values.app || !values.limits) throw new Error('--app and --limits are required');
const manifest = JSON.parse(readFileSync(join(values.app, 'public', 'assets', 'manifest.json'), 'utf8'));
const { limits } = JSON.parse(readFileSync(values.limits, 'utf8'));
const files = {
  ssrScript: join(values.app, 'public', manifest.hyper),
  csrShell: join(values.app, 'dist', 'csr', 'index.html'),
};

let failed = false;
for (const [name, file] of Object.entries(files)) {
  const limit = limits[name];
  if (typeof limit !== 'number') throw new Error(`no limit for ${name}`);
  const bytes = readFileSync(file);
  const gzip = gzipSync(bytes, { level: 9 }).length;
  const brotli = brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
  const verdict = gzip <= limit ? 'ok' : 'FAIL';
  if (verdict === 'FAIL') failed = true;
  console.log(`${verdict} ${name} ${file}: raw ${bytes.length}, gzip ${gzip} (limit ${limit}), brotli ${brotli}`);
}
if (failed) process.exit(1);
