// Makes one AST file per template and the template index (HR-34), which `hyper build` writes for the browser.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reservedTemplate } from '@polyspec/hyper/build';
import { listFiles } from './output-files.mjs';

// The file of a module of the template package `@polyspec/template` that this package depends on, such as
// `@polyspec/template` or `@polyspec/template/render`, by the `import` condition of its `exports` (HR-70).
function templateExport(specifier) {
  return fileURLToPath(import.meta.resolve(specifier));
}

// Parses every template of a directory and the reserved template hyper/data.tpl, which the core gives, with the
// template package of this package (HR-70) and returns, without writing a file, the index: template name ->
// { url: <urlPrefix>/<file> }, and files: the bytes of each AST file as { name: <file>, bytes }, whose name holds a
// hash of its content, the files that the build id hashes (HY-125).
export async function templateFiles({ templates, urlPrefix }) {
  const { encodeTemplate, parse } = await import('@polyspec/template');
  const dataTemplate = reservedTemplate();
  const sources = { [dataTemplate.name]: dataTemplate.source };
  for (const file of listFiles(templates).filter((name) => name.endsWith('.tpl')).sort()) {
    sources[relative(templates, file).split(sep).join('/')] = readFileSync(file, 'utf8');
  }
  const index = {};
  const files = [];
  for (const [name, source] of Object.entries(sources)) {
    // The native parse gives its own record of the AST; the renderer reads the canonical JSON of encodeTemplate.
    const text = encodeTemplate(parse(source, name));
    const file = `${name.replace(/\.tpl$/, '').replaceAll('/', '-')}.${sha256(text).slice(0, 12)}.json`;
    files.push({ name: file, bytes: Buffer.from(text, 'utf8') });
    index[name] = { url: `${urlPrefix}/${file}` };
  }
  return { index, files };
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
