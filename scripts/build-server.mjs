// Builds the server outputs of an application from its manifest and templates (HY-48), after the template rules
// of scripts/template-rules.mjs pass:
//   <output>/templates/   every template and the reserved template hyper/data.tpl, which the native
//                         template extension reads
//   <output>/program.php  the generated PHP program of the same templates, compiled with the compiler
//                         of the template repository into the namespace --php-namespace
//   <output>/program.json the namespace of the generated program
//   <output>/reads.json   the read paths of every route, by which the server keeps data (HY-73)
//
// Usage: node scripts/build-server.mjs --manifest examples/board/app/app.json --templates examples/board/templates
//          --output examples/board/build/server --template-dir var/products/template --php-namespace 'Polyspec\Hyper\Examples\Board\Program'

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { copyDirectory } from './output-files.mjs';
import { templateProblems } from './template-rules.mjs';

const { values } = parseArgs({ options: { manifest: { type: 'string' }, templates: { type: 'string' }, output: { type: 'string' }, 'template-dir': { type: 'string' }, 'php-namespace': { type: 'string' } } });
for (const name of ['manifest', 'templates', 'output', 'template-dir', 'php-namespace']) if (!values[name]) throw new Error(`--${name} is required`);
const compilerDir = resolve(values['template-dir'], 'tools', 'compiler');
const load = (file) => import(pathToFileURL(join(compilerDir, file)).href);
const { compileAst } = await load('ast-artifact.mjs');
const { compileSource } = await load('compiler.mjs');
const { deriveTypeManifest } = await load('type-manifest.mjs');
const { parse, resolvePath } = await import(pathToFileURL(resolve(values['template-dir'], 'packages', 'template-ts', 'dist', 'index.mjs')).href);
// The read paths module imports only types, so Node runs its source with type stripping, without a bundler (HY-68, HY-73).
const { routeReads } = await import(new URL('../packages/hyper-js/src/reads.ts', import.meta.url).href);

const manifest = JSON.parse(readFileSync(values.manifest, 'utf8'));
// HY-48: templates that break the template rules fail the build before it removes or writes any output.
const { problems } = templateProblems({ manifest, templatesDir: values.templates, parse, resolvePath });
if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  process.exit(1);
}
const dataTemplate = JSON.parse(readFileSync(new URL('../packages/hyper-js/data-template.json', import.meta.url), 'utf8'));
const output = resolve(values.output);
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
