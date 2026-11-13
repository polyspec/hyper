#!/usr/bin/env node
// Installs the command-line tool of binding at the commit that Cargo.lock pins for polyspec-binding-core, which
// `make bindings` and `make bindings-check` run (binding design L-2, G-6): one version of the generator and of
// binding_core. Before its first release binding is a Git dependency and its tool, packages/ts of the same repository,
// is in no package registry, so the tool comes from the checkout that Cargo made of the pinned commit. That checkout is
// cloned into var/binding/<commit>, a Git checkout of that commit, because binding check compares its own commit with
// the commit of Cargo.lock (CK-20), and npm installs the dependencies that the tool's package-lock.json pins (HR-70).
// The clone is made in a staging directory of this process and renamed into place, so a run that reads it never finds
// it half written (HR-82). This ends when binding is released.
//
//   node scripts/install-binding.mts --cargo <cargo> --npm <npm> --output <var/binding>

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { jsonArray, jsonObject, jsonString } from './json.mts';

const { values } = parseArgs({ options: { cargo: { type: 'string' }, npm: { type: 'string' }, output: { type: 'string' } } });
if (values.cargo === undefined || values.npm === undefined || values.output === undefined) {
  throw new Error('usage: install-binding.mts --cargo <cargo> --npm <npm> --output <directory>');
}
if (!isAbsolute(values.output)) throw new Error(`not an absolute path: ${values.output}`);
const root = resolve(import.meta.dirname, '..');

// cargo metadata fetches the locked Git dependencies and names the manifest of each package of the lock.
const metadata: unknown = JSON.parse(
  execFileSync(values.cargo, ['metadata', '--format-version', '1', '--locked', '--manifest-path', join(root, 'Cargo.toml')], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }),
);
const packages = jsonArray(jsonObject(metadata, 'cargo metadata').packages, 'cargo metadata packages').map((entry, i) => jsonObject(entry, `cargo metadata package ${i}`));
const core = packages.find((entry) => entry.name === 'polyspec-binding-core');
if (core === undefined) throw new Error('Cargo.lock has no Git dependency polyspec-binding-core');
const source = jsonString(core.source, 'the source of polyspec-binding-core');
const manifest = jsonString(core.manifest_path, 'the manifest of polyspec-binding-core');
const commit = /#([0-9a-f]{40})$/u.exec(source)?.[1];
if (commit === undefined) throw new Error(`polyspec-binding-core has no pinned commit: ${source}`);

// The crate is packages/core/rust of the binding repository; the tool is packages/ts of the same checkout.
const checkout = resolve(dirname(manifest), '../../..');
const target = join(values.output, commit);
if (existsSync(join(target, 'packages/ts/node_modules'))) {
  process.stdout.write(`install-binding: ${target} holds binding ${commit}\n`);
  process.exit(0);
}
mkdirSync(values.output, { recursive: true });
const staging = `${target}.next-${process.pid}`;
rmSync(staging, { recursive: true, force: true });
try {
  execFileSync('git', ['clone', '--quiet', '--no-checkout', checkout, staging], { stdio: 'inherit' });
  execFileSync('git', ['-C', staging, '-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--detach', commit], { stdio: 'inherit' });
  execFileSync(values.npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev'], { cwd: join(staging, 'packages/ts'), stdio: 'inherit' });
  rmSync(target, { recursive: true, force: true });
  renameSync(staging, target);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
process.stdout.write(`install-binding: installed binding ${commit} into ${target}\n`);
