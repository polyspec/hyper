// Builds the browser outputs of an application directory:
//   public/assets/templates/<name>.<hash>.json  one AST file per template, including hyper/data.tpl (HY-34)
//   build/templates.index.json                  template name -> file URL and referenced templates
//   public/assets/hyper-<hash>.js               the client bundle: htmx, the hyper browser code, the
//                                                template render runtime, the manifest and the index
//   public/assets/manifest.json                 the asset URLs that the server passes to the layout
//   dist/csr/                                   the static deployment for client-side rendering:
//                                                index.html with app.css and the bundle inlined,
//                                                assets/templates/ with the template files, and every
//                                                .css file directly in public/assets, which rendered
//                                                layouts link (HY-64)
//
// Usage: node scripts/build-assets.mjs --app examples/board --api /api

import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import { loadPackage, sha256, writeTemplateFiles } from './template-files.mjs';

const { values } = parseArgs({ options: { app: { type: 'string' }, api: { type: 'string' } } });
if (!values.app || !values.api) throw new Error('--app and --api are required');
const app = values.app;
const templatesDir = join(app, 'templates');
const buildDir = join(app, 'build');
const assetsDir = join(app, 'public', 'assets');
const templateFilesDir = join(assetsDir, 'templates');
const csrDir = join(app, 'dist', 'csr');
// The browser does not check the manifest that the bundle contains, so the build checks it before it writes anything (HY-2).
(await loadPackage()).checkManifest(JSON.parse(readFileSync(join(app, 'app', 'app.json'), 'utf8')));
const index = await writeTemplateFiles({ templates: templatesDir, output: templateFilesDir, urlPrefix: '/assets/templates' });
mkdirSync(buildDir, { recursive: true });
writeFileSync(join(buildDir, 'templates.index.json'), `${JSON.stringify(index, null, 2)}\n`);

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
writeFileSync(join(assetsDir, 'manifest.json'), `${JSON.stringify({ css: '/assets/app.css', reader: '/assets/reader.css', hyper: `/assets/${hyperName}` }, null, 2)}\n`);

const css = readFileSync(join(assetsDir, 'app.css'), 'utf8');
const shell = [
  '<!doctype html>',
  '<html>',
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
mkdirSync(join(csrDir, 'assets'), { recursive: true });
writeFileSync(join(csrDir, 'index.html'), shell);
cpSync(templateFilesDir, join(csrDir, 'assets', 'templates'), { recursive: true });
for (const name of readdirSync(assetsDir)) {
  if (name.endsWith('.css')) cpSync(join(assetsDir, name), join(csrDir, 'assets', name));
}

console.log(`templates ${Object.keys(index).length}, ${hyperName}, dist/csr/index.html ${Buffer.byteLength(shell)} bytes`);
console.log(`CSP for dist/csr/index.html: script-src 'sha256-${sha256(code, 'base64')}'; style-src 'self' 'sha256-${sha256(css, 'base64')}'`);
