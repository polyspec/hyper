// Tests that the name of every package of this repository states its role and that its directory below packages/
// states the role and the language of a server (HY-98): the manifest in the directory declares the name, and
// config/release.json releases the package from that directory.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const repository = resolve('.');
const release = JSON.parse(readFileSync(join(repository, 'config/release.json'), 'utf8'));

// The packages of HY-98: the directory, the kind of its manifest and the name.
const PACKAGES = [
  { directory: 'packages/hyper-client', kind: 'npm', name: '@polyspec/hyper-client' },
  { directory: 'packages/hyper-server-node', kind: 'npm', name: '@polyspec/hyper-server' },
  { directory: 'packages/hyper-build', kind: 'npm', name: '@polyspec/hyper-build' },
];

const MANIFEST = { npm: 'package.json', composer: 'composer.json' };

for (const { directory, kind, name } of PACKAGES) {
  test(`${directory} holds the ${kind} package ${name} and config/release.json releases it from there (HY-98)`, () => {
    const manifest = join(repository, directory, MANIFEST[kind]);
    assert.ok(existsSync(manifest), `${directory}/${MANIFEST[kind]} is missing`);
    assert.equal(JSON.parse(readFileSync(manifest, 'utf8')).name, name, `the name of ${directory}/${MANIFEST[kind]}`);
    const released = release.packages.filter(item => item.name === name);
    assert.deepEqual(released, [{ kind, directory, name }], `the entry of ${name} in config/release.json`);
  });
}
