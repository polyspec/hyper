#!/usr/bin/env node
// Builds the server outputs of an application from its manifest and templates (HY-48, HR-96), after the template
// rules of lib/template-rules.mjs pass:
//   <output>/templates/   every template and the reserved template hyper/data.tpl, which the native
//                         template extension reads
//   <output>/php/         the generated PHP program of the same templates, compiled with the compiler
//                         package @polyspec/template-compiler into the namespace --php-namespace as PSR-4
//                         files, one class per file; the application maps the namespace to this directory in
//                         autoload.psr-4 of its composer.json
//   <output>/program.json the namespace of the generated program
//   <output>/reads.json   the read paths of every route, by which the server keeps data (HY-73)
//   <output>/build.json   a copy of the file named by --build, the build id of the asset output (HY-125); the file
//                         must hold exactly the key "build" with a build id of 64 lowercase hexadecimal characters
//
// Usage: hyper-build-server --manifest app/app.json --templates templates --output build/server
//          --php-namespace 'App\Program' --build build/assets/build.json

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { routeReads } from '@polyspec/hyper-client';
import dataTemplate from '@polyspec/hyper-client/data-template.json' with { type: 'json' };
import { compileAst } from '@polyspec/template-compiler/ast-artifact.mjs';
import { compileFiles } from '@polyspec/template-compiler/compiler.mjs';
import { deriveTypeManifest } from '@polyspec/template-compiler/type-manifest.mjs';
import { parse, resolvePath } from '@polyspec/template';
import { copyDirectory } from '../lib/output-files.mjs';
import { publish, staging } from '../lib/publish.mjs';
import { templateProblems } from '../lib/template-rules.mjs';

const { values } = parseArgs({ options: { manifest: { type: 'string' }, templates: { type: 'string' }, output: { type: 'string' }, 'php-namespace': { type: 'string' }, build: { type: 'string' } } });
for (const name of ['manifest', 'templates', 'output', 'php-namespace', 'build']) if (!values[name]) throw new Error(`--${name} is required`);
if (!isAbsolute(values.build)) throw new Error(`--build is not an absolute path: ${values.build}`);
// HY-125: the build id is read before any output is written, so an invalid id writes nothing.
const buildText = readBuildFile(values.build);

const manifest = JSON.parse(readFileSync(values.manifest, 'utf8'));
// HY-48: templates that break the template rules fail the build before it removes or writes any output.
const { problems } = templateProblems({ manifest, templatesDir: values.templates, parse, resolvePath });
if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  process.exit(1);
}
// The output is written into a staging directory of this process and published file by file, the program files last
// and the class GeneratedProgram, which the server loads first, after the classes that it uses, so a server that reads
// the output never finds a file missing (HR-82).
const target = resolve(values.output);
const output = staging(target);
const templates = join(output, 'templates');
rmSync(output, { recursive: true, force: true });
copyDirectory(values.templates, templates);
mkdirSync(dirname(join(templates, dataTemplate.name)), { recursive: true });
writeFileSync(join(templates, dataTemplate.name), dataTemplate.source);

// Every template renders as a target with merge(shared, data) as root data, and every definition is the
// HTML of a region rendered alone, so no template takes template inputs (HY-12, HY-13, HY-30).
const parsed = new Map();
for (const name of listTemplates(templates)) parsed.set(name, parse(readFileSync(join(templates, name)), name));
const typesPath = join(output, 'types.json');
const types = deriveTypeManifest(parsed, {});
writeFileSync(typesPath, JSON.stringify({ ...types, entry: manifest.layout, templates: Object.fromEntries([...parsed.keys()].map((name) => [name, {}])) }));
const graph = join(output, 'graph');
compileAst({ root: templates, output: graph, entry: manifest.layout, refresh: 'true', typeManifest: typesPath });
const php = join(output, 'php');
mkdirSync(php);
for (const [file, source] of Object.entries(compileFiles(join(graph, 'manifest.json'), typesPath, 'php', { phpNamespace: values['php-namespace'] }))) {
  writeFileSync(join(php, file), source);
}
writeFileSync(join(output, 'program.json'), `${JSON.stringify({ namespace: values['php-namespace'] }, null, 2)}\n`);
writeFileSync(join(output, 'reads.json'), `${JSON.stringify({ routes: routeReads(manifest, (name) => parsed.get(name), resolvePath) })}\n`);
writeFileSync(join(output, 'build.json'), buildText);
publish(output, target, { last: ['reads.json', 'program.json', join('php', 'GeneratedProgram.php'), 'build.json'] });
process.stdout.write(`server program: ${parsed.size} templates, ${join(values.output, 'php')}\n`);

// Returns the text of the build file, which holds exactly the key `build` with a build id (HY-125). A file that cannot
// be read, is not JSON or holds another value fails with its path.
function readBuildFile(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`build id file ${file} cannot be read: ${error.message}`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`build id file ${file} is not JSON: ${error.message}`);
  }
  const keys = value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
  if (keys.length !== 1 || keys[0] !== 'build' || typeof value.build !== 'string' || !/^[0-9a-f]{64}$/.test(value.build)) {
    throw new Error(`build id file ${file} does not hold {"build": "<64 lowercase hexadecimal characters>"}`);
  }
  return text;
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
