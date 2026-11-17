// Tests `make node-addon` (H35.9-1): the generated entry packages/ts/native/generated/index.cjs loads, in a checkout,
// the file hyper.<platform>.node beside it (binding T-2), so make hyper-install and make hyper-test-node build the
// addon and put it there, and the Node server tests find the addon that they load.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ENTRY } from '../../packages/ts/src/app/core-rules.ts';
import { dryRun } from './make-dry-run.mts';

test('node-addon puts the addon beside the generated entry of the Node package (H35.9-1)', () => {
  const lines = dryRun('node-addon').join('\n');
  assert.match(lines, /cargo \S+ build --locked -p polyspec-hyper-node/u, lines);
  assert.match(lines, /mv -f \S+ packages\/ts\/native\/generated\/hyper\.[a-z0-9-]+\.node$/mu, lines);
});

test('hyper-install builds the Node addon after it writes the sources of the bindings (H35.9-1)', () => {
  const steps = dryRun('hyper-install')
    .map((line) => /--no-print-directory (\S+)/u.exec(line)?.[1])
    .filter((step) => step !== undefined);
  assert.ok(steps.includes('node-addon'), `hyper-install runs node-addon: ${steps.join(' ')}`);
  assert.ok(steps.indexOf('bindings') < steps.indexOf('node-addon'), `bindings runs before node-addon: ${steps.join(' ')}`);
});

test('hyper-test-node builds the Node addon before the tests (H35.9-1)', () => {
  const lines = dryRun('hyper-test-node').join('\n');
  assert.match(lines, /packages\/ts\/native\/generated\/hyper\.[a-z0-9-]+\.node/u, lines);
});

// The generated tests of the Node binding (H35.9-10) are a node:test file that imports the generated entry of the
// checkout, so they need the addon beside that entry, built with every test feature of the crate: the tests call the
// members that the features panic-test, fault-test, thread-test and thrown-count-test compile.
const GENERATED_TESTS = 'node -- packages/ts/native/generated/tests/generated.test.mjs';

test('test-node-addon builds the addon with the test features and runs the generated tests of the Node binding (H35.9-10)', () => {
  const lines = dryRun('test-node-addon');
  const build = lines.findIndex((line) => /cargo \S+ build --locked -p polyspec-hyper-node --features panic-test,fault-test,thread-test,thrown-count-test$/u.test(line));
  const put = lines.findIndex((line) => /mv -f \S+ packages\/ts\/native\/generated\/hyper\.[a-z0-9-]+\.node$/u.test(line));
  const run = lines.findIndex((line) => line.endsWith(GENERATED_TESTS) && /\/run-tests\.m[jt]s /u.test(line));
  assert.ok(build >= 0 && build < put && put < run, `the addon is built, put beside the entry and tested, in that order:\n${lines.join('\n')}`);
});

test('test-bindings, a target of the CI group core, runs the generated tests of the Node binding once (H35.9-10)', () => {
  const runs = dryRun('test-bindings').filter((line) => line.endsWith(GENERATED_TESTS));
  assert.equal(runs.length, 1, runs.join('\n'));
});

test('the vitest run of packages/ts selects no generated test of a binding (H35.9-10)', () => {
  // vitest selects every *.test.mjs below its directory unless the configuration excludes it, and the generated tests
  // of the Node and the WASM binding are node:test files, in which vitest finds no suite.
  const config = readFileSync('packages/ts/vitest.config.mts', 'utf8');
  assert.match(config, /exclude: \[\.\.\.configDefaults\.exclude, 'native\/\*\*'\]/u, config);
});

test('the entry that rules() loads resolves from src/app and dist/app and is a file of the packed package (H35.9-1)', () => {
  const pkg: unknown = JSON.parse(readFileSync('packages/ts/package.json', 'utf8'));
  const build: unknown = JSON.parse(readFileSync('packages/ts/tsconfig.build.json', 'utf8'));
  assert.ok(build !== null && typeof build === 'object' && 'compilerOptions' in build, 'tsconfig.build.json has compilerOptions');
  assert.partialDeepStrictEqual(build.compilerOptions, { rootDir: 'src', outDir: 'dist' });
  assert.ok(pkg !== null && typeof pkg === 'object' && 'files' in pkg && Array.isArray(pkg.files), 'package.json has files');
  for (const place of ['src/app', 'dist/app']) assert.equal(path.posix.join('packages/ts', place, ENTRY), 'packages/ts/native/generated/index.cjs', place);
  assert.ok(pkg.files.includes('dist') && pkg.files.includes('native/generated/index.cjs') && pkg.files.includes('native/generated/*.node'), String(pkg.files));
});
