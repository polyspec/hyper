#!/usr/bin/env node
// Builds the server programs of the applications of contracts/context.json (HY-48, HY-125) for the server tests. For each
// application it writes its manifest, its templates and its build id file into <output>/<application>/ and runs
// hyper-build-server of @polyspec/hyper-build, which writes <output>/<application>/program.
//
// Usage: context-programs.mjs --contract contracts/context.json --output var/context-programs
// Both paths are absolute.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { contract: { type: 'string' }, output: { type: 'string' } } });
for (const name of ['contract', 'output']) {
  if (!values[name]) throw new Error(`--${name} is required`);
  if (!isAbsolute(values[name])) throw new Error(`--${name} is not an absolute path: ${values[name]}`);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildTool = join(root, 'packages/build/bin/hyper-build-server.mjs');
const contract = JSON.parse(readFileSync(values.contract, 'utf8'));

for (const [key, application] of Object.entries(contract.applications)) {
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
  const namespace = `Polyspec\\Hyper\\Tests\\Context\\${key.split('_').map((word) => word[0].toUpperCase() + word.slice(1)).join('')}\\Program`;
  const run = spawnSync(
    process.execPath,
    [buildTool, '--manifest', manifest, '--templates', templates, '--output', join(directory, 'program'),
      '--php-namespace', namespace, '--build', build],
    { encoding: 'utf8' },
  );
  if (run.status !== 0) {
    throw new Error(`building the context application ${key} failed with status ${run.status}: ${run.stdout}${run.stderr}`);
  }
  process.stdout.write(`built ${key} into ${join(directory, 'program')}\n`);
}
