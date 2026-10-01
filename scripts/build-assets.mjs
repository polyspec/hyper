// Builds the browser outputs of an application directory:
//   public/assets/templates/<name>.<hash>.json  one AST file per template, including hyper/data.tpl (HY-34)
//   build/templates.index.json                  template name -> file URL and referenced templates
//   public/assets/hyper-<hash>.js               the client bundle: htmx, the hyper browser code, the
//                                                template render runtime, the manifest and the index
//   public/assets/manifest.json                 the asset URLs that the server passes to the layout
//   dist/csr/                                   the static deployment for client-side rendering:
//                                                index.html with the stylesheet and the bundle inlined,
//                                                and assets/templates/ with the template files
//
// Usage: node scripts/build-assets.mjs --app examples/board --api /api

import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const templateFilesDir = join(assetsDir, 'templates');
const csrDir = join(app, 'dist', 'csr');
const dataTemplate = JSON.parse(readFileSync(join('packages', 'hyper-js', 'data-template.json'), 'utf8'));
const { templateReferences } = await loadPackage();

const sources = { [dataTemplate.name]: dataTemplate.source };
for (const file of listFiles(templatesDir).filter((name) => name.endsWith('.tpl')).sort()) {
  sources[relative(templatesDir, file).split(sep).join('/')] = readFileSync(file, 'utf8');
}

rmSync(templateFilesDir, { recursive: true, force: true });
mkdirSync(templateFilesDir, { recursive: true });
const index = {};
for (const [name, source] of Object.entries(sources)) {
  const ast = parse(source, name);
  const text = JSON.stringify(ast);
  const file = `${name.replace(/\.tpl$/, '').replaceAll('/', '-')}.${sha256(text).slice(0, 12)}.json`;
  writeFileSync(join(templateFilesDir, file), text);
  index[name] = { url: `/assets/templates/${file}`, deps: templateReferences(ast, name) };
}
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
mkdirSync(join(csrDir, 'assets'), { recursive: true });
writeFileSync(join(csrDir, 'index.html'), shell);
cpSync(templateFilesDir, join(csrDir, 'assets', 'templates'), { recursive: true });

console.log(`templates ${Object.keys(index).length}, ${hyperName}, dist/csr/index.html ${Buffer.byteLength(shell)} bytes`);
console.log(`CSP for dist/csr/index.html: script-src 'sha256-${sha256(code, 'base64')}'; style-src 'sha256-${sha256(css, 'base64')}'`);

// Loads templateReferences from the hyper browser package (HY-34).
async function loadPackage() {
  const result = await build({
    stdin: { contents: "export { templateReferences } from '@polyspec/hyper';", resolveDir: join('packages', 'hyper-js'), sourcefile: 'build-entry.ts', loader: 'ts' },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    logLevel: 'error',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
}

function sha256(text, encoding = 'hex') {
  return createHash('sha256').update(text).digest(encoding);
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}
