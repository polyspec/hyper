// Tests `make node-addon` (H35.9-1): the generated entry packages/ts/native/generated/index.cjs loads, in a checkout,
// the file hyper.<platform>.node beside it (binding T-2), so make hyper-install and make hyper-test-node build the
// addon and put it there, and the Node server tests find the addon that they load.
import assert from 'node:assert/strict';
import { test } from 'node:test';
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
