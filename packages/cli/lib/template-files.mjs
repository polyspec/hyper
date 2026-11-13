// Makes one AST file per template and the template index (HR-34). `hyper build` and the template build of test
// fixtures use it, so the browser and the Node server read the same template files.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import dataTemplate from '@polyspec/hyper-client/data-template.json' with { type: 'json' };
import { listFiles, writeFileAtomic } from './output-files.mjs';

// The file of a module of the template package `@polyspec/template` that this package depends on, such as
// `@polyspec/template` or `@polyspec/template/render`, by the `import` condition of its `exports` (HR-70).
function templateExport(specifier) {
  return fileURLToPath(import.meta.resolve(specifier));
}

// Parses every template of a directory and the reserved template hyper/data.tpl of the browser package with the
// template package of this package (HR-70) and returns, without writing a file, the index: template name ->
// { url: <urlPrefix>/<file> }, and files: the bytes of each AST file as { name: <file>, bytes }, whose name holds a
// hash of its content, the files that the build id hashes (HY-125).
export async function templateFiles({ templates, urlPrefix }) {
  const { parse } = await import('@polyspec/template');
  const sources = { [dataTemplate.name]: dataTemplate.source };
  for (const file of listFiles(templates).filter((name) => name.endsWith('.tpl')).sort()) {
    sources[relative(templates, file).split(sep).join('/')] = readFileSync(file, 'utf8');
  }
  const index = {};
  const files = [];
  for (const [name, source] of Object.entries(sources)) {
    const text = JSON.stringify(parse(source, name));
    const file = `${name.replace(/\.tpl$/, '').replaceAll('/', '-')}.${sha256(text).slice(0, 12)}.json`;
    files.push({ name: file, bytes: Buffer.from(text, 'utf8') });
    index[name] = { url: `${urlPrefix}/${file}` };
  }
  return { index, files };
}

// Adds the files of templateFiles to <output> and returns its index and files. The directory only gains files: a file
// name holds the hash of its content, so an earlier build keeps its files.
export async function writeTemplateFiles({ templates, output, urlPrefix }) {
  const result = await templateFiles({ templates, urlPrefix });
  mkdirSync(output, { recursive: true });
  for (const file of result.files) writeFileAtomic(join(output, file.name), file.bytes);
  return result;
}

// The esbuild plugin that resolves `@polyspec/template` and its subpaths to the template package that this package
// depends on, whatever template package the application installed (HR-70).
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
