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
// Usage: contract-programs.mts --contract <contracts/context.json> --contract <contracts/functions.json> --reads
// <contracts/reads.json> --output <var/contract-programs>. Every path is absolute.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { writeFileAtomic } from '../packages/build/lib/output-files.mjs';
import { publish, staging } from '../packages/build/lib/publish.mjs';
import { writeTemplateFiles } from '../packages/build/lib/template-files.mjs';
import { buildId } from '../packages/build/lib/build-id.mjs';

const { values } = parseArgs({ options: { contract: { type: 'string', multiple: true }, reads: { type: 'string' }, output: { type: 'string' } } });
if (!values.contract || values.contract.length === 0) throw new Error('--contract is required');
if (!values.reads) throw new Error('--reads is required');
if (!values.output) throw new Error('--output is required');
for (const path of [...values.contract, values.reads, values.output]) {
  if (!isAbsolute(path)) throw new Error(`not an absolute path: ${path}`);
}

// An application of a contract file: its manifest, its templates by their names and its build id.
interface Application {
  manifest: unknown;
  templates: Record<string, string>;
  build: string;
}

// A case of reads.json: its id, its templates and the template that its application renders.
interface ReadsCase {
  id: string;
  template: string;
  templates: Record<string, string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isTemplates = (value: unknown): value is Record<string, string> => isRecord(value) && Object.values(value).every((source) => typeof source === 'string');

// Returns the member of a JSON file that must be an object or a list, and fails for another file.
function member(path: string, name: string): unknown {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isRecord(parsed) || !(name in parsed)) throw new Error(`${path} has no member ${name}`);
  return parsed[name];
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildTool = join(root, 'packages/build/bin/hyper-build-server.mjs');
const applications = new Map<string, { path: string; application: Application }>();
for (const path of values.contract) {
  const listed = member(path, 'applications');
  if (!isRecord(listed)) throw new Error(`the applications of ${path} are not an object`);
  for (const [key, application] of Object.entries(listed)) {
    if (applications.has(key)) throw new Error(`the application ${key} of ${path} is also an application of ${applications.get(key)?.path}`);
    if (!isRecord(application) || !isTemplates(application.templates) || typeof application.build !== 'string') throw new Error(`the application ${key} of ${path} names no templates or no build id`);
    applications.set(key, { path, application: { manifest: application.manifest, templates: application.templates, build: application.build } });
  }
}

// HY-73: each case of reads.json is an application of its own, named reads_<id>, which renders the template of the case.
const cases = member(values.reads, 'cases');
if (!Array.isArray(cases)) throw new Error(`the cases of ${values.reads} are not a list`);
for (const entry of cases) {
  if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.template !== 'string' || !isTemplates(entry.templates)) throw new Error(`a case of ${values.reads} names no id, no template or no templates`);
  const key = `reads_${entry.id}`;
  if (applications.has(key)) throw new Error(`the application ${key} of ${values.reads} is also an application of ${applications.get(key)?.path}`);
  applications.set(key, { path: values.reads, application: readsApplication({ id: entry.id, template: entry.template, templates: entry.templates }) });
}

const failures: string[] = [];
for (const [key, { application }] of applications) {
  // The PHP program of the application <key> is written to <output>/<key>/program/php, and its namespace repeats that
  // path below the prefix Polyspec\Hyper\Server\Tests\Contract\, which a PSR-4 entry maps to the output directory. The name
  // of an application is therefore a segment of a PHP namespace.
  if (!/^[a-z_][a-z0-9_]*$/u.test(key)) {
    failures.push(`the application ${key} has a name that is no segment of a PHP namespace`);
    continue;
  }
  // HR-82: the application is built in a staging directory of this process and published file by file, so that a test
  // that reads the application while another run builds it finds no file missing.
  const target = join(values.output, key);
  const directory = staging(target);
  rmSync(directory, { recursive: true, force: true });
  try {
    const templates = join(directory, 'templates');
    mkdirSync(templates, { recursive: true });
    for (const [name, source] of Object.entries(application.templates)) {
      writeFileSync(join(templates, name), source);
    }
    const manifest = join(directory, 'manifest.json');
    writeFileSync(manifest, JSON.stringify(application.manifest));
    const build = join(directory, 'build.json');
    writeFileSync(build, JSON.stringify({ build: application.build }));
    const namespace = `Polyspec\\Hyper\\Server\\Tests\\Contract\\${key}\\program\\php`;
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
    publish(directory, target);
    process.stdout.write(`built ${key} into ${join(target, 'program')} and ${join(target, 'node')}\n`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
if (failures.length > 0) throw new Error(failures.join('\n'));

// Returns the application of a case of reads.json: its templates with the layout and the title that the build requires
// (HY-3), and the build id of its output files (HY-125).
function readsApplication(entry: ReadsCase): Application {
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
