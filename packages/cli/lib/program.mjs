// Assembles the server program of an application (HY-48, HY-73) in a directory, the `program/` of `hyper build`
// (HR-34), and writes its build id. `hyper build` passes the id that it computed from its outputs (HY-125.21); a test
// that needs a fixed id builds its program with the same functions and that id, so the rules of the assembly exist once.
//   templates/    every template of the application, and no copy of the reserved template hyper/data.tpl (HY-31.9)
//   reads.json    the read paths of every route, by which the server keeps data (HY-73), as readsFile of the core
//                 writes them (@polyspec/hyper/build)
//   build.json    {"build":"<id>"}, whose text is buildFileText of the core (HY-125.23), written by the build
// The program holds no generated PHP program (HY-48.20): the three servers render the templates of templates/.
// The assembly has two parts. This module computes the content of the files with the core, which loads the native
// addon of the platform. lib/program-files.mjs writes the files and loads no addon. writeProgram composes them: the
// templates are written, the other files are computed from the written templates (programFiles) and then written.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildFileText, readsFile } from '@polyspec/hyper/build';
import { writeProgramFiles, writeProgramTemplates } from './program-files.mjs';

/**
 * Writes build.json of `directory` with the build id `id`, whose text the core gives (HY-125.23); an id of another
 * form fails with the kind `invalid_build` (HY-125.19).
 */
export function writeBuildFile(directory, id) {
  writeProgramFiles(directory, [['build.json', buildFileText(id)]]);
}

/** The files of the program that a reader takes after every other file, so it never finds a file missing (HR-82). */
export const PROGRAM_LAST = ['reads.json', 'build.json'];

/**
 * Writes the program of `manifest` and the templates below `templates` into `directory`, which must not exist, without
 * its build.json, and returns the number of templates.
 */
export function writeProgram({ manifest, templates, directory }) {
  const programTemplates = writeProgramTemplates(templates, directory);
  const { count, files } = programFiles({ manifest, templates: programTemplates });
  writeProgramFiles(directory, files);
  return count;
}

/**
 * Computes the files of the program of `manifest` other than its templates and its build.json from `templates`, the
 * directory of templates that writeProgramTemplates wrote. Returns the number of templates and the files, pairs of a
 * path below the program and its text, in the order in which writeProgramFiles writes them.
 */
export function programFiles({ manifest, templates }) {
  const sources = new Map();
  for (const name of listTemplates(templates)) sources.set(name, readFileSync(join(templates, name)).toString('utf8'));
  // HY-73.34: the core computes the read paths from the manifest and the template sources and writes their text.
  /** @type {[string, string][]} */
  const files = [['reads.json', readsFile(Buffer.from(JSON.stringify(manifest)), sources)]];
  return { count: sources.size, files };
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
