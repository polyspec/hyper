// Assembles the server program of an application (HY-48, HY-73) in a directory, the `program/` of `hyper build`
// (HR-34), and writes its build id. `hyper build` passes the id that it computed from its outputs (HY-125.21); a test
// that needs a fixed id builds its program with the same functions and that id, so the rules of the assembly exist once.
//   templates/    every template of the application, and no copy of the reserved template hyper/data.tpl (HY-31.9)
//   legacy/       hyper/data.tpl, the copy of the reserved template for a server that does not call the core
//                 (HY-31.10)
//   reads.json    the read paths of every route, by which the server keeps data (HY-73), as readsFile of the core
//                 writes them (@polyspec/hyper/build)
//   php/          with a PHP namespace: the generated PHP program of the same templates, compiled with the compiler
//                 package @polyspec/template-compiler into that namespace as PSR-4 files, one class per file
//   program.json  with a PHP namespace: the namespace of the generated program
//   build.json    {"build":"<id>"}, written by writeBuildFile (HY-125.18)
// The intermediate files of the compilation, the type manifest and the AST graph, lie in a temporary directory that
// the assembly removes, not in the program.
// The assembly has two parts. This module computes the content of the files with the template library, the compiler
// and the core, each of which loads the native addon of the platform. lib/program-files.mjs writes the files and
// loads no addon. writeProgram composes them: the templates are written, the other files are computed from the written
// templates (programFiles) and then written.

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readsFile } from '@polyspec/hyper/build';
import dataTemplate from '@polyspec/hyper-client/data-template.json' with { type: 'json' };
import { compileAst } from '@polyspec/template-compiler/ast-artifact.mjs';
import { compileFiles } from '@polyspec/template-compiler/compiler.mjs';
import { deriveTypeManifest } from '@polyspec/template-compiler/type-manifest.mjs';
import { parse } from '@polyspec/template';
import { copyDirectory } from './output-files.mjs';
import { writeProgramFiles, writeProgramTemplates, writeReservedTemplate } from './program-files.mjs';

export { writeBuildFile } from './program-files.mjs';

/** The files of the program that a reader takes after every other file, so it never finds a file missing (HR-82). */
export const PROGRAM_LAST = ['reads.json', 'program.json', join('php', 'GeneratedProgram.php'), 'build.json'];

/**
 * Writes the program of `manifest` and the templates below `templates` into `directory`, which must not exist, without
 * its build.json, and returns the number of templates.
 */
export function writeProgram({ manifest, templates, directory, phpNamespace }) {
  const programTemplates = writeProgramTemplates(templates, directory);
  const { count, files } = programFiles({ manifest, templates: programTemplates, phpNamespace });
  writeProgramFiles(directory, files);
  return count;
}

/**
 * Computes the files of the program of `manifest` other than its templates and its build.json from `templates`, the
 * directory of templates that writeProgramTemplates wrote. Returns the number of templates and the files, pairs of a
 * path below the program and its text, in the order in which writeProgramFiles writes them.
 */
export function programFiles({ manifest, templates, phpNamespace }) {
  const parsed = new Map();
  const sources = new Map();
  for (const name of listTemplates(templates)) {
    const source = readFileSync(join(templates, name));
    parsed.set(name, parse(source, name));
    sources.set(name, source.toString('utf8'));
  }
  /** @type {[string, string][]} */
  const files = phpNamespace === undefined ? [] : phpFiles({ manifest, parsed, templates, phpNamespace });
  // HY-73.23: the core computes the read paths from the manifest and the template sources and writes their text.
  files.push(['reads.json', readsFile(Buffer.from(JSON.stringify(manifest)), sources)]);
  return { count: parsed.size, files };
}

// The targets, the layout, the title, the reserved data template, the manifest region templates, the route templates
// and the route region templates, render with merge(shared, data) as root data and take no template inputs (HY-12,
// HY-13, HY-30, HY-31); every other template keeps the inputs that deriveTypeManifest derives from its block arguments
// (HY-73.16).
// The compilation reads a directory of this run, the templates of the application and the reserved template, because
// templates/ of the program holds no copy of the reserved template (HY-31.9) and the generated program renders it.
function phpFiles({ manifest, parsed: application, templates, phpNamespace }) {
  const work = mkdtempSync(join(tmpdir(), 'hyper-program-'));
  try {
    const root = join(work, 'templates');
    copyDirectory(templates, root);
    writeReservedTemplate(root);
    const parsed = new Map([...application, [dataTemplate.name, parse(Buffer.from(dataTemplate.source), dataTemplate.name)]].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    const typesPath = join(work, 'types.json');
    const types = deriveTypeManifest(parsed, {});
    const targets = new Set([manifest.layout, manifest.title, dataTemplate.name, ...manifest.regions.map((region) => region.template), ...manifest.routes.flatMap((route) => [route.template, ...(route.regions ?? []).map((region) => region.template)])].filter((name) => name !== undefined));
    writeFileSync(typesPath, JSON.stringify({ ...types, entry: manifest.layout, templates: Object.fromEntries([...parsed.keys()].map((name) => [name, targets.has(name) ? {} : (types.templates[name] ?? {})])) }));
    const graph = join(work, 'graph');
    compileAst({ root, output: graph, entry: manifest.layout, refresh: 'true', typeManifest: typesPath });
    /** @type {[string, string][]} */
    const files = Object.entries(compileFiles(join(graph, 'manifest.json'), typesPath, 'php', { phpNamespace })).map(([file, source]) => [join('php', file), source]);
    files.push(['program.json', `${JSON.stringify({ namespace: phpNamespace }, null, 2)}\n`]);
    return files;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function listTemplates(root, prefix = '') {
  const names = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) names.push(...listTemplates(root, name));
    else if (entry.name.endsWith('.tpl')) names.push(name);
  }
  return names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
