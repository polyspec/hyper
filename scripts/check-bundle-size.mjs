// Prints the sizes of the browser outputs of an application and fails when a gzip size exceeds its
// limit: the server-side rendering script, the client-side rendering shell and the largest template file.
//
// Usage: node scripts/check-bundle-size.mjs --app examples/board --output examples/board/build --limits config/bundle-size.json

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const { values } = parseArgs({ options: { app: { type: 'string' }, output: { type: 'string' }, limits: { type: 'string' } } });
if (!values.app || !values.output || !values.limits) throw new Error('--app, --output and --limits are required');
const manifest = JSON.parse(readFileSync(join(values.output, 'manifest.json'), 'utf8'));
const { limits } = JSON.parse(readFileSync(values.limits, 'utf8'));
// The template files of the build that --output describes; public/assets/templates keeps the files of earlier builds.
const index = JSON.parse(readFileSync(join(values.output, 'templates.index.json'), 'utf8'));
const templates = Object.values(index).map(({ url }) => join(values.app, 'public', url));
const largestTemplate = templates.reduce((largest, file) => (gzipSync(readFileSync(file)).length > gzipSync(readFileSync(largest)).length ? file : largest));
const files = {
  ssrScript: join(values.app, 'public', manifest.hyper),
  csrShell: join(values.output, 'csr', 'index.html'),
  largestTemplate,
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
const templatesGzip = templates.reduce((total, file) => total + gzipSync(readFileSync(file), { level: 9 }).length, 0);
console.log(`templates: ${templates.length} files, ${templatesGzip} gzip bytes in total, loaded when rendering reaches them`);
if (failed) process.exit(1);
