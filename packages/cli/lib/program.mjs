// Assembles the server program of an application (HY-48, HY-73) in a directory, the `program/` of `hyper build`
// (HR-34), and writes its build id. `hyper build` passes the id that it computed from its outputs (HY-125.21); a test
// that needs a fixed id builds its program with the same functions and that id, so the rules of the assembly exist once.
//   templates/    every template and, until the build takes it from the core, the reserved template hyper/data.tpl
//   reads.json    the read paths of every route, by which the server keeps data (HY-73)
//   php/          with a PHP namespace: the generated PHP program of the same templates, compiled with the compiler
//                 package @polyspec/template-compiler into that namespace as PSR-4 files, one class per file
//   program.json  with a PHP namespace: the namespace of the generated program
//   build.json    {"build":"<id>"}, written by writeBuildFile (HY-125.18)
// The intermediate files of the compilation, the type manifest and the AST graph, lie in a temporary directory that
// the assembly removes, not in the program.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { routeReads } from '@polyspec/hyper-client';
import dataTemplate from '@polyspec/hyper-client/data-template.json' with { type: 'json' };
import { compileAst } from '@polyspec/template-compiler/ast-artifact.mjs';
import { compileFiles } from '@polyspec/template-compiler/compiler.mjs';
import { deriveTypeManifest } from '@polyspec/template-compiler/type-manifest.mjs';
import { parse, resolvePath } from '@polyspec/template';
import { copyDirectory } from './output-files.mjs';

const BUILD_ID = /^[0-9a-f]{64}$/;

/** The files of the program that a reader takes after every other file, so it never finds a file missing (HR-82). */
export const PROGRAM_LAST = ['reads.json', 'program.json', join('php', 'GeneratedProgram.php'), 'build.json'];

/**
 * Writes the program of `manifest` and the templates below `templates` into `directory`, which must not exist, without
 * its build.json, and returns the number of templates.
 */
export function writeProgram({ manifest, templates, directory, phpNamespace }) {
  const programTemplates = join(directory, 'templates');
  copyDirectory(templates, programTemplates);
  mkdirSync(dirname(join(programTemplates, dataTemplate.name)), { recursive: true });
  writeFileSync(join(programTemplates, dataTemplate.name), dataTemplate.source);
  const parsed = new Map();
  for (const name of listTemplates(programTemplates)) parsed.set(name, parse(readFileSync(join(programTemplates, name)), name));
  if (phpNamespace !== undefined) writePhp({ manifest, parsed, templates: programTemplates, directory, phpNamespace });
  writeFileSync(join(directory, 'reads.json'), `${JSON.stringify({ routes: routeReads(manifest, (name) => parsed.get(name), resolvePath) })}\n`);
  return parsed.size;
}

/** Writes `{"build":"<id>"}` into build.json of `directory`; an id that is not 64 lowercase hexadecimal digits fails. */
export function writeBuildFile(directory, id) {
  if (!BUILD_ID.test(id)) throw new Error(`the build id ${id} is not 64 lowercase hexadecimal characters (HY-125.19)`);
  writeFileSync(join(directory, 'build.json'), `{"build":"${id}"}`);
}

// The targets, the layout, the title, the reserved data template, the manifest region templates, the route templates
// and the route region templates, render with merge(shared, data) as root data and take no template inputs (HY-12,
// HY-13, HY-30, HY-31); every other template keeps the inputs that deriveTypeManifest derives from its block arguments
// (HY-73.16).
function writePhp({ manifest, parsed, templates, directory, phpNamespace }) {
  const work = mkdtempSync(join(tmpdir(), 'hyper-program-'));
  try {
    const typesPath = join(work, 'types.json');
    const types = deriveTypeManifest(parsed, {});
    const targets = new Set([manifest.layout, manifest.title, dataTemplate.name, ...manifest.regions.map((region) => region.template), ...manifest.routes.flatMap((route) => [route.template, ...(route.regions ?? []).map((region) => region.template)])].filter((name) => name !== undefined));
    writeFileSync(typesPath, JSON.stringify({ ...types, entry: manifest.layout, templates: Object.fromEntries([...parsed.keys()].map((name) => [name, targets.has(name) ? {} : (types.templates[name] ?? {})])) }));
    const graph = join(work, 'graph');
    compileAst({ root: templates, output: graph, entry: manifest.layout, refresh: 'true', typeManifest: typesPath });
    const php = join(directory, 'php');
    mkdirSync(php);
    for (const [file, source] of Object.entries(compileFiles(join(graph, 'manifest.json'), typesPath, 'php', { phpNamespace }))) {
      writeFileSync(join(php, file), source);
    }
    writeFileSync(join(directory, 'program.json'), `${JSON.stringify({ namespace: phpNamespace }, null, 2)}\n`);
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
