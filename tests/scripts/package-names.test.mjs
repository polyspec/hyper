// Tests that the name of every package of this repository states its role and that its directory below packages/
// states the role and the language of a server (HY-98): the manifest in the directory declares the name, and
// config/release.json releases the package from that directory, or names its manifest for the git tag.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const repository = resolve('.');
const release = JSON.parse(readFileSync(join(repository, 'config/release.json'), 'utf8'));

// The packages of HY-98: the directory, the kind of its manifest and the name.
const PACKAGES = [
  { directory: 'packages/hyper-client', kind: 'npm', name: '@polyspec/hyper-client' },
  { directory: 'packages/hyper-server-node', kind: 'npm', name: '@polyspec/hyper-server' },
  { directory: 'packages/hyper-server-php', kind: 'composer', name: 'polyspec/hyper-server' },
  { directory: 'packages/hyper-server-python', kind: 'python', name: 'polyspec-hyper-server' },
  { directory: 'packages/hyper-build', kind: 'npm', name: '@polyspec/hyper-build' },
];

const MANIFEST = { npm: 'package.json', composer: 'composer.json', python: 'pyproject.toml' };

// The name of a manifest: the field name of package.json and composer.json, the name of [project] of pyproject.toml.
function manifestName(kind, text) {
  if (kind !== 'python') return JSON.parse(text).name;
  const project = /^\[project\]\n([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(text);
  return project === null ? null : /^name = "([^"]*)"$/m.exec(project[1])?.[1] ?? null;
}

for (const { directory, kind, name } of PACKAGES) {
  test(`${directory} holds the ${kind} package ${name} and config/release.json releases it from there (HY-98)`, () => {
    const manifest = join(repository, directory, MANIFEST[kind]);
    assert.ok(existsSync(manifest), `${directory}/${MANIFEST[kind]} is missing`);
    assert.equal(manifestName(kind, readFileSync(manifest, 'utf8')), name, `the name of ${directory}/${MANIFEST[kind]}`);
    if (kind === 'python') {
      // A Python package is consumed by the git tag and has no archive; config/release.json names its manifest.
      assert.equal(release.manifests[`${directory}/${MANIFEST[kind]}`], 'git-tag', `the manifest entry of ${name} in config/release.json`);
      return;
    }
    const released = release.packages.filter(item => item.name === name);
    assert.deepEqual(released, [{ kind, directory, name }], `the entry of ${name} in config/release.json`);
  });
}

test('packages/ holds only the tracked directories of HY-98', () => {
  const tracked = execFileSync('git', ['ls-files', '-z', 'packages'], { cwd: repository, encoding: 'utf8' })
    .split('\0').filter(Boolean).map(path => path.split('/').slice(0, 2).join('/'));
  assert.deepEqual([...new Set(tracked)].sort(), PACKAGES.map(item => item.directory).sort());
});
