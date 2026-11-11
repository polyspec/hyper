#!/usr/bin/env node
// Builds the applications of the contract files contracts/context.json, contracts/functions.json and
// contracts/representations.json (HY-48, HY-125) and one application for each case of contracts/reads.json (HY-73) for
// the tests of the three servers. The application names of all contracts are distinct. For each application it writes
// into <output>/<application>/:
//   manifest.json, templates/ and build.json   the inputs that the case states
//   program/                                   the server program of hyper-build-server, which PHP and Python open
//   node/templates.index.json, node/templates/ the template files that the Node server opens (HR-34)
//
// The application of a case of reads.json is named reads_<id>: its templates are the templates of the case, with the
// layout and the title that hyper-build-server requires, so that its program renders the template of the case.
//
// Usage: contract-programs.mjs --contract <contracts/context.json> --contract <contracts/functions.json> --reads
// <contracts/reads.json> --output <var/contract-programs>. Every path is absolute.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { writeFileAtomic } from '../packages/build/lib/output-files.mjs';
import { writeTemplateFiles } from '../packages/build/lib/template-files.mjs';
import { buildId } from '../packages/build/lib/build-id.mjs';

const { values } = parseArgs({ options: { contract: { type: 'string', multiple: true }, reads: { type: 'string' }, output: { type: 'string' } } });
if (!values.contract || values.contract.length === 0) throw new Error('--contract is required');
if (!values.reads) throw new Error('--reads is required');
if (!values.output) throw new Error('--output is required');
for (const path of [...values.contract, values.reads, values.output]) {
  if (!isAbsolute(path)) throw new Error(`not an absolute path: ${path}`);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildTool = join(root, 'packages/build/bin/hyper-build-server.mjs');
const applications = new Map();
for (const path of values.contract) {
  for (const [key, application] of Object.entries(JSON.parse(readFileSync(path, 'utf8')).applications)) {
    if (applications.has(key)) throw new Error(`the application ${key} of ${path} is also an application of ${applications.get(key).path}`);
    applications.set(key, { path, application });
  }
}

// HY-73: each case of reads.json is an application of its own, named reads_<id>, which renders the template of the case.
for (const entry of JSON.parse(readFileSync(values.reads, 'utf8')).cases) {
  const key = `reads_${entry.id}`;
  if (applications.has(key)) throw new Error(`the application ${key} of ${values.reads} is also an application of ${applications.get(key).path}`);
  applications.set(key, { path: values.reads, application: readsApplication(entry) });
}

const failures = [];
for (const [key, { application }] of applications) {
  const directory = join(values.output, key);
  rmSync(directory, { recursive: true, force: true });
  const templates = join(directory, 'templates');
  mkdirSync(templates, { recursive: true });
  for (const [name, source] of Object.entries(application.templates)) {
    writeFileSync(join(templates, name), source);
  }
  const manifest = join(directory, 'manifest.json');
  writeFileSync(manifest, JSON.stringify(application.manifest));
  const build = join(directory, 'build.json');
  writeFileSync(build, JSON.stringify({ build: application.build }));
  const namespace = `Polyspec\\Hyper\\Tests\\Contract\\${key.split('_').map((word) => word[0].toUpperCase() + word.slice(1)).join('')}\\Program`;
  const run = spawnSync(
    process.execPath,
    [buildTool, '--manifest', manifest, '--templates', templates, '--output', join(directory, 'program'),
      '--php-namespace', namespace, '--build', build],
    { encoding: 'utf8' },
  );
  if (run.status !== 0) {
    failures.push(`building the application ${key} failed with status ${run.status}: ${run.stdout}${run.stderr}`);
    continue;
  }
  const node = join(directory, 'node');
  const { index } = await writeTemplateFiles({ templates, output: join(node, 'templates'), urlPrefix: '/templates' });
  writeFileAtomic(join(node, 'templates.index.json'), `${JSON.stringify(index, null, 2)}\n`);
  process.stdout.write(`built ${key} into ${join(directory, 'program')} and ${node}\n`);
}
if (failures.length > 0) throw new Error(failures.join('\n'));

// Returns the application of a case of reads.json: its templates with the layout and the title that the build requires
// (HY-3), and the build id of its output files (HY-125).
function readsApplication(entry) {
  const templates = { ...entry.templates };
  for (const name of ['layout.tpl', 'title.tpl']) {
    if (Object.hasOwn(templates, name)) throw new Error(`the case ${entry.id} names ${name}, which its application reserves`);
  }
  templates['layout.tpl'] = '<head><title>{# title}</title>{# build}</head>\n<main id="content">{# content}</main>\n{# data}\n';
  templates['title.tpl'] = '{= title}';
  const build = buildId(Object.entries(templates).map(([path, source]) => ({ path, bytes: Buffer.from(source) })));
  return {
    manifest: { layout: 'layout.tpl', title: 'title.tpl', regions: [{ name: 'content', page: true }], routes: [{ name: 'reads', path: '/', title: 'Reads', template: entry.template }] },
    templates,
    build,
  };
}
