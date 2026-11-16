// Tests `make node-addon` (H35.9-1): the generated entry packages/ts/native/generated/index.cjs loads, in a checkout,
// the file hyper.<platform>.node beside it (binding T-2), so make hyper-install and make hyper-test-node build the
// addon and put it there, and the Node server tests find the addon that they load.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ENTRY } from '../../packages/ts/src/app/core-rules.ts';
import { dryRun } from './make-dry-run.mts';

const LOCAL = ['BINDING_COMMIT=local', 'BINDING=/lane/cli.js'];

test('node-addon puts the addon beside the generated entry of the Node package (H35.9-1)', () => {
  const lines = dryRun('node-addon', { variables: LOCAL }).join('\n');
  assert.match(lines, /cargo build --locked -p polyspec-hyper-node/u, lines);
  assert.match(lines, /mv -f \S+ packages\/ts\/native\/generated\/hyper\.[a-z0-9-]+\.node$/mu, lines);
});

test('hyper-install builds the Node addon after it writes the sources of the bindings (H35.9-1)', () => {
  const steps = dryRun('hyper-install', { variables: LOCAL })
    .map((line) => /--no-print-directory (\S+)/u.exec(line)?.[1])
    .filter((step) => step !== undefined);
  assert.ok(steps.includes('node-addon'), `hyper-install runs node-addon: ${steps.join(' ')}`);
  assert.ok(steps.indexOf('bindings') < steps.indexOf('node-addon'), `bindings runs before node-addon: ${steps.join(' ')}`);
});

test('hyper-test-node builds the Node addon before the tests (H35.9-1)', () => {
  const lines = dryRun('hyper-test-node', { variables: LOCAL }).join('\n');
  assert.match(lines, /packages\/ts\/native\/generated\/hyper\.[a-z0-9-]+\.node/u, lines);
});

test('the entry that rules() loads resolves from src/app and dist/app and is a file of the packed package (H35.9-1)', () => {
  const pkg = JSON.parse(readFileSync('packages/ts/package.json', 'utf8')) as { files: string[] };
  const build = JSON.parse(readFileSync('packages/ts/tsconfig.build.json', 'utf8')) as { compilerOptions: { rootDir: string; outDir: string } };
  assert.deepEqual([build.compilerOptions.rootDir, build.compilerOptions.outDir], ['src', 'dist']);
  for (const place of ['src/app', 'dist/app']) assert.equal(path.posix.join('packages/ts', place, ENTRY), 'packages/ts/native/generated/index.cjs', place);
  assert.ok(pkg.files.includes('dist') && pkg.files.includes('native/generated/index.cjs') && pkg.files.includes('native/generated/*.node'), pkg.files.join(' '));
});
