// The host manifest of the Node package names what the release of the npm-native package reads (H31.3-3, binding
// GN-3b, GN-3c): the name of the addon, the three targets that the release builds, and the module type of the package.
// The contract check of the binding states them only as a finding among others, so this test reads the three items.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST = 'packages/ts/package.json';

/** The value of `key` of the object `value`, or undefined when `value` is no object. */
function member(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
}

const manifest: unknown = JSON.parse(readFileSync(path.join(ROOT, MANIFEST), 'utf8'));
const napi = member(manifest, 'napi');

test('the Node package names the addon hyper in napi.binaryName (H31.3-3)', () => {
  assert.equal(member(napi, 'binaryName'), 'hyper', `${MANIFEST} napi.binaryName`);
});

test('the Node package names the three targets of the release in napi.targets (H31.3-3)', () => {
  const targets = member(napi, 'targets');
  assert.ok(Array.isArray(targets) && targets.every((target): target is string => typeof target === 'string'), `${MANIFEST} napi.targets is a list of strings`);
  const names: string[] = targets;
  assert.deepEqual([...names].sort(), ['aarch64-apple-darwin', 'aarch64-unknown-linux-gnu', 'x86_64-unknown-linux-gnu'], `${MANIFEST} napi.targets`);
});

test('the Node package is a module package (H31.3-3)', () => {
  assert.equal(member(manifest, 'type'), 'module', `${MANIFEST} type`);
});
