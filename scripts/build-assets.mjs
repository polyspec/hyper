// Builds the browser outputs of an application directory from one client bundle (htmx, the hyper
// browser code, the template render runtime, the manifest and the template ASTs):
//   build/templates.ast.json      the template AST bundle that the client bundle imports
//   public/assets/hyper-<hash>.js the client bundle for server-side rendering
//   public/assets/manifest.json   the asset URLs that the server passes to the layout
//   dist/csr/index.html           the static shell for client-side rendering, with the stylesheet
//                                 and the client bundle inlined; it is the only file to deploy
//
// Usage: node scripts/build-assets.mjs --app examples/board --api /api

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import { parse } from '@polyspec/template';

const { values } = parseArgs({ options: { app: { type: 'string' }, api: { type: 'string' } } });
if (!values.app || !values.api) throw new Error('--app and --api are required');
const app = values.app;
const templatesDir = join(app, 'templates');
const buildDir = join(app, 'build');
const assetsDir = join(app, 'public', 'assets');
const csrDir = join(app, 'dist', 'csr');

const templates = {};
for (const file of listFiles(templatesDir).filter((name) => name.endsWith('.tpl')).sort()) {
  const name = relative(templatesDir, file).split(sep).join('/');
  templates[name] = parse(readFileSync(file), name);
}
mkdirSync(buildDir, { recursive: true });
writeFileSync(join(buildDir, 'templates.ast.json'), JSON.stringify(templates));

const bundle = await build({
  entryPoints: [join(app, 'client', 'main.ts')],
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  write: false,
  logLevel: 'error',
});
const code = Buffer.from(bundle.outputFiles[0].contents).toString('utf8');
if (/<\/script/i.test(code)) throw new Error('the client bundle contains </script and cannot be inlined');
const hyperName = `hyper-${sha256(code).slice(0, 12)}.js`;

for (const name of readdirSync(assetsDir)) {
  if (/^(hyper-[0-9a-f]+\.js|manifest\.json)$/.test(name)) rmSync(join(assetsDir, name));
}
writeFileSync(join(assetsDir, hyperName), code);
writeFileSync(join(assetsDir, 'manifest.json'), `${JSON.stringify({ css: '/assets/app.css', hyper: `/assets/${hyperName}` }, null, 2)}\n`);

const css = readFileSync(join(assetsDir, 'app.css'), 'utf8');
const shell = [
  '<!doctype html>',
  '<html lang="ko">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  `<meta name="hyper-api" content="${values.api}">`,
  '<title></title>',
  `<style>${css}</style>`,
  `<script type="module">${code}</script>`,
  '</head>',
  '<body></body>',
  '</html>',
  '',
].join('\n');
rmSync(csrDir, { recursive: true, force: true });
mkdirSync(csrDir, { recursive: true });
writeFileSync(join(csrDir, 'index.html'), shell);

console.log(`templates ${Object.keys(templates).length}, ${hyperName}, dist/csr/index.html ${Buffer.byteLength(shell)} bytes`);
console.log(`CSP for dist/csr/index.html: script-src 'sha256-${sha256(code, 'base64')}'; style-src 'sha256-${sha256(css, 'base64')}'`);

function sha256(text, encoding = 'hex') {
  return createHash('sha256').update(text).digest(encoding);
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}
