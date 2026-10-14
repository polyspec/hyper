#!/usr/bin/env node
// Builds the server outputs of an application from its manifest and templates (HY-48, HY-96), after the template
// rules of lib/template-rules.mjs pass:
//   <output>/templates/   every template and the reserved template hyper/data.tpl, which the native
//                         template extension reads
//   <output>/program.php  the generated PHP program of the same templates, compiled with the compiler
//                         package @polyspec/template-compiler into the namespace --php-namespace
//   <output>/program.json the namespace of the generated program
//   <output>/reads.json   the read paths of every route, by which the server keeps data (HY-73)
//
// Usage: hyper-build-server --manifest app/app.json --templates templates --output build/server
//          --php-namespace 'App\Program'

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { routeReads } from '@polyspec/hyper-client';
import dataTemplate from '@polyspec/hyper-client/data-template.json' with { type: 'json' };
import { compileAst } from '@polyspec/template-compiler/ast-artifact.mjs';
import { compileSource } from '@polyspec/template-compiler/compiler.mjs';
import { deriveTypeManifest } from '@polyspec/template-compiler/type-manifest.mjs';
import { parse, resolvePath } from '@polyspec/template';
import { copyDirectory } from '../lib/output-files.mjs';
import { publish, staging } from '../lib/publish.mjs';
import { templateProblems } from '../lib/template-rules.mjs';

const { values } = parseArgs({ options: { manifest: { type: 'string' }, templates: { type: 'string' }, output: { type: 'string' }, 'php-namespace': { type: 'string' } } });
for (const name of ['manifest', 'templates', 'output', 'php-namespace']) if (!values[name]) throw new Error(`--${name} is required`);

const manifest = JSON.parse(readFileSync(values.manifest, 'utf8'));
// HY-48: templates that break the template rules fail the build before it removes or writes any output.
const { problems } = templateProblems({ manifest, templatesDir: values.templates, parse, resolvePath });
if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  process.exit(1);
}
// The output is written into a staging directory of this process and published file by file, the program files last,
// so a server that reads the output never finds a file missing (HY-82).
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
writeFileSync(join(output, 'program.php'), compileSource(join(graph, 'manifest.json'), typesPath, 'php', { phpNamespace: values['php-namespace'] }));
writeFileSync(join(output, 'program.json'), `${JSON.stringify({ namespace: values['php-namespace'] }, null, 2)}\n`);
writeFileSync(join(output, 'reads.json'), `${JSON.stringify({ routes: routeReads(manifest, (name) => parsed.get(name), resolvePath) })}\n`);
publish(output, target, { last: ['reads.json', 'program.json', 'program.php'] });
process.stdout.write(`server program: ${parsed.size} templates, ${join(values.output, 'program.php')}\n`);

function listTemplates(root, prefix = '') {
  const names = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) names.push(...listTemplates(root, name));
    else if (entry.name.endsWith('.tpl')) names.push(name);
  }
  return names.sort();
}
