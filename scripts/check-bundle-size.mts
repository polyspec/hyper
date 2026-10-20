// Measures the browser outputs of an application: the server-side rendering script, the client-side rendering shell,
// the chunk files that the entry loads with import() when that code first runs (HYC-16), together, and the largest
// template file. It prints each size with its gzip limit, and a size above its limit is a warning, never
// a failure, because performance is measured and reported (AGENTS): a line `WARNING <name> ...`, and on GitHub Actions
// an annotation `::warning::`, which the CI summary lists (make ci-summary of @polyspec/kit). A missing input fails.
//
// Usage: node scripts/check-bundle-size.mts --app examples/board --output examples/board/build --limits config/bundle-size.json

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { checkTemplateIndex } from '@polyspec/hyper-client';
import { jsonObject, jsonString, parseJsonObject } from './json.mts';

const { values } = parseArgs({ options: { app: { type: 'string' }, output: { type: 'string' }, limits: { type: 'string' } } });
const { app, output, limits: limitsFile } = values;
if (!app || !output || !limitsFile) throw new Error('--app, --output and --limits are required');
const manifestFile = join(output, 'manifest.json');
const hyper = jsonString(parseJsonObject(readFileSync(manifestFile, 'utf8'), manifestFile).hyper, `${manifestFile} hyper`);
const limits = jsonObject(parseJsonObject(readFileSync(limitsFile, 'utf8'), limitsFile).limits, `${limitsFile} limits`);
// The template files of the build that --output describes; public/assets/templates keeps the files of earlier builds.
const indexFile = join(output, 'templates.index.json');
const index = checkTemplateIndex(JSON.parse(readFileSync(indexFile, 'utf8')), indexFile);
const templates = Object.values(index).map((entry) => join(app, 'public', entry.url));
const [firstTemplate] = templates;
if (firstTemplate === undefined) throw new Error(`${join(output, 'templates.index.json')} names no template file; expected at least 1, actual 0`);
const largestTemplate = templates.reduce((largest, file) => (gzipSync(readFileSync(file)).length > gzipSync(readFileSync(largest)).length ? file : largest), firstTemplate);
// The chunk files of the build that --output describes are those of its static deployment csr/assets, which holds the
// files of this build only; public/assets keeps the files of earlier builds. The browser loads them together the first
// time the entry runs the code that it imports with import(), so they are measured as one output.
const csrAssets = join(output, 'csr', 'assets');
const chunks = readdirSync(csrAssets).filter((name) => /^hyper-chunk-[A-Z0-9]+\.js$/.test(name)).sort().map((name) => join(csrAssets, name));
if (chunks.length === 0) throw new Error(`${csrAssets} holds no chunk file hyper-chunk-<hash>.js; expected at least 1, actual 0`);
const files = {
  ssrScript: [join(app, 'public', hyper)],
  csrShell: [join(output, 'csr', 'index.html')],
  chunks,
  largestTemplate: [largestTemplate],
};

for (const [name, paths] of Object.entries(files)) {
  const limit = limits[name];
  if (typeof limit !== 'number') throw new Error(`no limit for ${name}`);
  const file = paths.join(', ');
  // Each file is a response of its own, compressed alone, so an output of several files sums the sizes of its files.
  const contents = paths.map((path) => readFileSync(path));
  const sum = (sizes: number[]) => sizes.reduce((total, size) => total + size, 0);
  const gzip = sum(contents.map((bytes) => gzipSync(bytes, { level: 9 }).length));
  const brotli = sum(contents.map((bytes) => brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length));
  const raw = sum(contents.map((bytes) => bytes.length));
  if (gzip <= limit) {
    console.log(`ok ${name} ${file}: gzip ${gzip} bytes within the limit ${limit}; raw ${raw}, brotli ${brotli}`);
    continue;
  }
  console.log(`WARNING ${name} ${file}: gzip ${gzip} bytes exceed the limit ${limit}; raw ${raw}, brotli ${brotli}`);
  if (process.env.GITHUB_ACTIONS === 'true') console.log(`::warning title=bundle size::${name}: gzip ${gzip} bytes exceed the limit ${limit}`);
}
const templatesGzip = templates.reduce((total, file) => total + gzipSync(readFileSync(file), { level: 9 }).length, 0);
console.log(`templates: ${templates.length} files, ${templatesGzip} gzip bytes in total, loaded when rendering reaches them`);
