// Writes one AST file per template and the template index (HY-34). The asset build and the template build of
// test fixtures use it, so the browser and the Node server read the same template files.

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { writeFileAtomic } from './output-files.mjs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// The browser package in this repository. The scripts read its source, not its build output, from any working directory.
const browserPackage = fileURLToPath(new URL('../packages/hyper-js/', import.meta.url));

// The file of a module of the template package `@polyspec/template` that this repository installs, such as
// `@polyspec/template` or `@polyspec/template/render`, by the `import` condition of its `exports` (HY-70).
export function templateExport(specifier) {
  return fileURLToPath(import.meta.resolve(specifier));
}

// Parses every template of a directory and the reserved template hyper/data.tpl with the installed template package
// (HY-70), adds each AST as <output>/<name>.<hash>.json and returns the index: template
// name -> { url: <urlPrefix>/<file>, deps }.
export async function writeTemplateFiles({ templates, output, urlPrefix }) {
  const { parse } = await import('@polyspec/template');
  const dataTemplate = JSON.parse(readFileSync(join(browserPackage, 'data-template.json'), 'utf8'));
  const sources = { [dataTemplate.name]: dataTemplate.source };
  for (const file of listFiles(templates).filter((name) => name.endsWith('.tpl')).sort()) {
    sources[relative(templates, file).split(sep).join('/')] = readFileSync(file, 'utf8');
  }
  // The directory only gains files: a file name holds the hash of its content, so an earlier build keeps its files.
  mkdirSync(output, { recursive: true });
  const index = {};
  for (const [name, source] of Object.entries(sources)) {
    const ast = parse(source, name);
    const text = JSON.stringify(ast);
    const file = `${name.replace(/\.tpl$/, '').replaceAll('/', '-')}.${sha256(text).slice(0, 12)}.json`;
    writeFileAtomic(join(output, file), text);
    index[name] = { url: `${urlPrefix}/${file}` };
  }
  return index;
}

// The esbuild plugin that resolves `@polyspec/template` and its subpaths to the template package that this repository
// installs, whatever template package the application installed (HY-70).
export function templatePlugin() {
  return {
    name: 'template-package',
    setup(builder) {
      builder.onResolve({ filter: /^@polyspec\/template(\/.*)?$/ }, (args) => ({ path: templateExport(args.path) }));
    },
  };
}

// Bundles checkManifest from the source of the hyper browser package with the installed template package (HY-70);
// the result names its input files.
export async function bundlePackage() {
  const templatePackage = templatePlugin();
  return build({
    stdin: { contents: "export { checkManifest } from './src/index.ts';", resolveDir: browserPackage, sourcefile: 'build-entry.ts', loader: 'ts' },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    metafile: true,
    logLevel: 'error',
    plugins: [templatePackage],
  });
}

// Loads checkManifest from the hyper browser package (HY-2, HY-70).
export async function loadPackage() {
  const result = await bundlePackage();
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
}

export function sha256(text, encoding = 'hex') {
  return createHash('sha256').update(text).digest(encoding);
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}
