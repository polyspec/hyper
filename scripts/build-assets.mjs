// Builds the browser outputs of an application directory (HY-76):
//   public/assets/templates/<name>.<hash>.json  one AST file per template, including hyper/data.tpl (HY-34)
//   build/templates.index.json                  template name -> file URL
//   public/assets/hyper-<hash>.js               the client entry: htmx, the hyper browser code, the template render
//                                                runtime, the manifest and the index
//   public/assets/hyper-chunk-<hash>.js         one chunk file per code that the entry imports with import() only,
//                                                which the browser loads by its absolute URL when the code first runs
//   public/assets/manifest.json                 the URL of the entry, which the server passes to the layout
//   <output> of --tailwind <source>=<output>     the source stylesheet compiled with the Tailwind theme and the
//                                                utilities that templates/ and client/ use, its rules in the
//                                                layer components (HY-77)
//   dist/csr/                                   the static deployment for client-side rendering: index.html with the
//                                                entry inlined and no stylesheet, assets/templates/ with the template
//                                                files, the chunk files, and every .css file directly in
//                                                public/assets, which rendered layouts link (HY-64)
//
// The template ASTs, the manifest check and the template render runtime of the bundle come from the template package
// of the template repository --template-dir, whatever template package the application installed (HY-70).
//
// Usage: node scripts/build-assets.mjs --app examples/board --api /api --template-dir ../template

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import { copyDirectory, copyFile } from './output-files.mjs';
import { loadPackage, sha256, templatePlugin, writeTemplateFiles } from './template-files.mjs';

const { values } = parseArgs({ options: { app: { type: 'string' }, api: { type: 'string' }, 'template-dir': { type: 'string' }, tailwind: { type: 'string' } } });
if (!values.app || !values.api || !values['template-dir']) throw new Error('--app, --api and --template-dir are required');
const templateDir = values['template-dir'];
const app = values.app;
const templatesDir = join(app, 'templates');
const buildDir = join(app, 'build');
const assetsDir = join(app, 'public', 'assets');
const templateFilesDir = join(assetsDir, 'templates');
const csrDir = join(app, 'dist', 'csr');
// The browser does not check the manifest that the bundle contains, so the build checks it before it writes anything (HY-2).
(await loadPackage(templateDir)).checkManifest(JSON.parse(readFileSync(join(app, 'app', 'app.json'), 'utf8')));
const index = await writeTemplateFiles({ templates: templatesDir, output: templateFilesDir, urlPrefix: '/assets/templates', templateDir });
mkdirSync(buildDir, { recursive: true });
writeFileSync(join(buildDir, 'templates.index.json'), `${JSON.stringify(index, null, 2)}\n`);

const bundle = await build({
  entryPoints: [join(app, 'client', 'main.ts')],
  bundle: true,
  splitting: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outdir: assetsDir,
  publicPath: '/assets',
  entryNames: 'hyper-[hash]',
  chunkNames: 'hyper-chunk-[hash]',
  write: false,
  logLevel: 'error',
  plugins: [templatePlugin(templateDir)],
});
const scripts = bundle.outputFiles.map((file) => ({ name: basename(file.path), code: Buffer.from(file.contents).toString('utf8') }));
const entries = scripts.filter((script) => !script.name.startsWith('hyper-chunk-'));
if (entries.length !== 1) throw new Error(`the client build wrote ${entries.length} entry files`);
const entry = entries[0];
if (/<\/script/i.test(entry.code)) throw new Error('the client entry contains </script and cannot be inlined');

for (const name of readdirSync(assetsDir)) {
  if (/^(hyper-[A-Za-z0-9-]+\.js|manifest\.json)$/.test(name)) rmSync(join(assetsDir, name));
}
for (const script of scripts) writeFileSync(join(assetsDir, script.name), script.code);
writeFileSync(join(assetsDir, 'manifest.json'), `${JSON.stringify({ hyper: `/assets/${entry.name}` }, null, 2)}\n`);

// The compiled stylesheet lies in public/assets before the static deployment copies the stylesheets (HY-77).
if (values.tailwind !== undefined) {
  const [source, output, ...rest] = values.tailwind.split('=');
  if (!source || !output || rest.length > 0) throw new Error(`--tailwind ${values.tailwind} is not <source>=<output>`);
  const css = await tailwind(readFileSync(join(app, source), 'utf8'));
  mkdirSync(dirname(join(app, output)), { recursive: true });
  writeFileSync(join(app, output), css);
}

const shell = [
  '<!doctype html>',
  '<html>',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  `<meta name="hyper-api" content="${values.api}">`,
  '<title></title>',
  `<script type="module">${entry.code}</script>`,
  '</head>',
  '<body></body>',
  '</html>',
  '',
].join('\n');
rmSync(csrDir, { recursive: true, force: true });
mkdirSync(join(csrDir, 'assets'), { recursive: true });
writeFileSync(join(csrDir, 'index.html'), shell);
copyDirectory(templateFilesDir, join(csrDir, 'assets', 'templates'));
for (const name of readdirSync(assetsDir)) {
  if (name.endsWith('.css') || name.startsWith('hyper-chunk-')) copyFile(join(assetsDir, name), join(csrDir, 'assets', name));
}

// Compiles the rules of an application stylesheet with the theme and the utilities of Tailwind CSS that the
// templates and the client code use; the rules lie in the layer components and no rule of the layer base exists
// (HY-77). Tailwind CSS resolves from the dependencies of this repository.
async function tailwind(rules) {
  const input = [
    '@layer theme, base, components, utilities;',
    '@import "tailwindcss/theme.css" layer(theme);',
    '@import "tailwindcss/utilities.css" layer(utilities);',
    `@source "${resolve(templatesDir)}";`,
    `@source "${resolve(app, 'client')}";`,
    `@layer components {\n${rules.trimEnd()}\n}`,
  ].join('\n');
  const compiler = await compile(input, { base: dirname(dirname(fileURLToPath(import.meta.url))), onDependency: () => {} });
  const candidates = new Scanner({ sources: compiler.sources }).scan();
  return compiler.build(candidates);
}

console.log(`templates ${Object.keys(index).length}, ${entry.name}, ${scripts.length - 1} chunks, dist/csr/index.html ${Buffer.byteLength(shell)} bytes`);
console.log(`CSP for dist/csr/index.html: script-src 'self' 'sha256-${sha256(entry.code, 'base64')}'; style-src 'self'`);
