// Builds the server program of a test fixture with the fixed build id of its build file (HY-125.21): the assembly of
// `hyper build` (packages/cli/lib/program.mjs) with that id as its argument, so the tests read a program of the same
// rules without changing a build output. The program is published file by file (HR-82).
//
// Usage: node scripts/fixture-program.mts --manifest <app.json> --templates <directory> --output <directory>
//          --php-namespace <namespace> --id-file <build.json>

import { readFileSync, rmSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { PROGRAM_LAST, writeBuildFile, writeProgram } from '../packages/cli/lib/program.mjs';
import { publish, staging } from '../packages/cli/lib/publish.mjs';
import { jsonString, parseJsonObject } from './json.mts';

const { values } = parseArgs({ options: { manifest: { type: 'string' }, templates: { type: 'string' }, output: { type: 'string' }, 'php-namespace': { type: 'string' }, 'id-file': { type: 'string' } } });
const { manifest, templates, output } = values;
const phpNamespace = values['php-namespace'];
const idFile = values['id-file'];
if (manifest === undefined || templates === undefined || output === undefined || phpNamespace === undefined || idFile === undefined) {
  throw new Error('--manifest, --templates, --output, --php-namespace and --id-file are required');
}
const id = jsonString(parseJsonObject(readFileSync(idFile, 'utf8'), idFile).build, `${idFile} build`);
const directory = staging(output);
rmSync(directory, { recursive: true, force: true });
try {
  const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'));
  const count = writeProgram({ manifest: parsed, templates, directory, phpNamespace });
  writeBuildFile(directory, id);
  publish(directory, output, { last: PROGRAM_LAST });
  console.log(`program ${output}: ${count} templates, build ${id}`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
