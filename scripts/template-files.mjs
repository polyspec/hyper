// Writes one AST file per template and the template index (HY-34). The asset build and the template build of
// test fixtures use it, so the browser and the Node server read the same template files.

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { build } from 'esbuild';
import { parse } from '@polyspec/template';

// Parses every template of a directory and the reserved template hyper/data.tpl, writes each AST to
// <output>/<name>.<hash>.json and returns the index: template name -> { url: <urlPrefix>/<file>, deps }.
export async function writeTemplateFiles({ templates, output, urlPrefix }) {
  const dataTemplate = JSON.parse(readFileSync(join('packages', 'hyper-js', 'data-template.json'), 'utf8'));
  const { templateReferences } = await loadPackage();
  const sources = { [dataTemplate.name]: dataTemplate.source };
  for (const file of listFiles(templates).filter((name) => name.endsWith('.tpl')).sort()) {
    sources[relative(templates, file).split(sep).join('/')] = readFileSync(file, 'utf8');
  }
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  const index = {};
  for (const [name, source] of Object.entries(sources)) {
    const ast = parse(source, name);
    const text = JSON.stringify(ast);
    const file = `${name.replace(/\.tpl$/, '').replaceAll('/', '-')}.${sha256(text).slice(0, 12)}.json`;
    writeFileSync(join(output, file), text);
    index[name] = { url: `${urlPrefix}/${file}`, deps: templateReferences(ast, name) };
  }
  return index;
}

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

export function sha256(text, encoding = 'hex') {
  return createHash('sha256').update(text).digest(encoding);
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}
