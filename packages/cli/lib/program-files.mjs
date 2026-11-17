// Writes the files of the server program of an application into a directory: the writing part of the assembly of
// lib/program.mjs, which computes the content. This module imports only node:fs and the copies of
// lib/output-files.mjs, and no package that loads a native addon, so a process that holds no addon of its platform,
// such as the Linux container of tests/virtiofs/output-files.test.mts, writes a program whose content another process
// computed with the functions of the build.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { copyDirectory } from './output-files.mjs';

const BUILD_ID = /^[0-9a-f]{64}$/;

/**
 * Copies the templates below `templates` into `templates/` of `directory`, which must not exist, and returns that
 * directory of templates. It holds no copy of the reserved template hyper/data.tpl (HY-31.9), because the core gives it
 * to every server and refuses a template of the application of that name (HY-48.21).
 * @param {string} templates
 * @param {string} directory
 * @returns {string}
 */
export function writeProgramTemplates(templates, directory) {
  const programTemplates = join(directory, 'templates');
  copyDirectory(templates, programTemplates);
  return programTemplates;
}

/**
 * Writes every file of `files`, pairs of a path below `directory` and its text, in their order, and creates the
 * directories of each path.
 * @param {string} directory
 * @param {readonly (readonly [string, string])[]} files
 */
export function writeProgramFiles(directory, files) {
  for (const [name, content] of files) {
    mkdirSync(dirname(join(directory, name)), { recursive: true });
    writeFileSync(join(directory, name), content);
  }
}

/**
 * Writes `{"build":"<id>"}` into build.json of `directory`; an id that is not 64 lowercase hexadecimal digits fails.
 * @param {string} directory
 * @param {string} id
 */
export function writeBuildFile(directory, id) {
  if (!BUILD_ID.test(id)) throw new Error(`the build id ${id} is not 64 lowercase hexadecimal characters (HY-125.19)`);
  writeFileSync(join(directory, 'build.json'), `{"build":"${id}"}`);
}
