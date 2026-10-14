// Writes one AST file per template and the template index (HY-34). The asset build and the template build of
// test fixtures use it, so the browser and the Node server read the same template files.

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import dataTemplate from '@polyspec/hyper-client/data-template.json' with { type: 'json' };
import { writeFileAtomic } from './output-files.mjs';

// The file of a module of the template package `@polyspec/template` that this package depends on, such as
// `@polyspec/template` or `@polyspec/template/render`, by the `import` condition of its `exports` (HY-70).
export function templateExport(specifier) {
  return fileURLToPath(import.meta.resolve(specifier));
}

// Parses every template of a directory and the reserved template hyper/data.tpl of the browser package with the
// template package of this package (HY-70), adds each AST as <output>/<name>.<hash>.json and returns the index:
// template name -> { url: <urlPrefix>/<file> }.
export async function writeTemplateFiles({ templates, output, urlPrefix }) {
  const { parse } = await import('@polyspec/template');
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

// The esbuild plugin that resolves `@polyspec/template` and its subpaths to the template package that this package
// depends on, whatever template package the application installed (HY-70).
export function templatePlugin() {
  return {
    name: 'template-package',
    setup(builder) {
      builder.onResolve({ filter: /^@polyspec\/template(\/.*)?$/ }, (args) => ({ path: templateExport(args.path) }));
    },
  };
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
