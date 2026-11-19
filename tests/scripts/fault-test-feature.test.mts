// Tests where the fault injection feature `fault-test` of the PHP extension and of the Python wheel is enabled (H35.11-3,
// the ruling of the leader): hyper's test targets build both with the feature, so their fault cases arm the fault points
// of http-form, and the release recipes build both without it, so a release carries no fault point.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dryRun } from './make-dry-run.mts';

const lines = (target: string) => dryRun(target).join('\n');

test('the PHP extension of the tests is built with fault-test into its own directory (H35.11-3)', () => {
  const commands = lines('hyper-ext-test');
  assert.match(commands, /cargo build \S*--features fault-test\b/, commands);
  assert.match(commands, /build\/hyper-ext-test/, commands);
});

test('the PHP tests load the extension built with fault-test (H35.11-3)', () => {
  const commands = lines('hyper-test-php');
  assert.match(commands, /build\/hyper-ext-test\/polyspec_hyper\.so/, commands);
});

test('the Python wheel of the tests is built with fault-test (H35.11-3)', () => {
  const commands = lines('hyper-install-python-test');
  assert.match(commands, /maturin .*--features fault-test\b/, commands);
});

test('the Python tests install the wheel built with fault-test (H35.11-3)', () => {
  const commands = lines('hyper-test-python');
  assert.match(commands, /hyper-install-python-test|--features fault-test/, commands);
});

test('the release recipe of the PHP extension does not enable fault-test (H35.11-3)', () => {
  const commands = lines('hyper-ext');
  assert.doesNotMatch(commands, /fault-test/, commands);
  assert.match(commands, /build\/hyper-ext\//, commands);
});

test('the release recipe of the Python wheel does not enable fault-test (H35.11-3)', () => {
  const commands = lines('hyper-install-python');
  assert.doesNotMatch(commands, /fault-test/, commands);
});
