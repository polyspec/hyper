// Tests that the name of every package of this repository states its role and that its directory below packages/
// states the role and the language of the server library (HR-98): the manifest in the directory declares the name, and
// config/release.json releases the package from that directory, the Python package as a wheel (H23.15). The native
// module of a language package sits in native/ of its directory, where the PHP extension is a Composer package of its
// own (binding L-2a).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { jsonObjects, jsonString, parseJsonObject } from '../../scripts/json.mts';

const repository = resolve('.');
type Kind = 'npm' | 'composer' | 'python';
// The packages that config/release.json releases.
const released = jsonObjects(parseJsonObject(readFileSync(join(repository, 'config/release.json'), 'utf8'), 'config/release.json').packages, 'config/release.json packages');

// The packages of HR-98: the directory, the kind of its manifest, the name, and the product and the runtime of the label of
// its release asset (kit P39).
const PACKAGES: { directory: string; kind: Kind; name: string; product: string; runtime: string }[] = [
  { directory: 'packages/client', kind: 'npm', name: '@polyspec/hyper-client', product: 'hyper-client', runtime: 'ts' },
  { directory: 'packages/ts', kind: 'npm', name: '@polyspec/hyper', product: 'hyper', runtime: 'ts' },
  { directory: 'packages/php', kind: 'composer', name: 'polyspec/hyper', product: 'hyper', runtime: 'php' },
  { directory: 'packages/python', kind: 'python', name: 'polyspec-hyper', product: 'hyper', runtime: 'python' },
  { directory: 'packages/cli', kind: 'npm', name: '@polyspec/hyper-cli', product: 'hyper-cli', runtime: 'ts' },
];

// The Composer package of the PHP extension of the server library, which binding scaffold writes (binding L-2a). The
// host packages take their native modules with the bindings, and config/release.json releases it then.
const NATIVE: { directory: string; kind: Kind; name: string }[] = [
  { directory: 'packages/php/native', kind: 'composer', name: 'polyspec/hyper-native' },
];

const MANIFEST: Record<Kind, string> = { npm: 'package.json', composer: 'composer.json', python: 'pyproject.toml' };
// The package kind of config/release.json for each kind of manifest: kit releases a Python package as a wheel.
const RELEASED_KIND: Record<Kind, string> = { npm: 'npm', composer: 'composer', python: 'wheel' };

// The name of a manifest: the field name of package.json and composer.json, the name of [project] of pyproject.toml.
function manifestName(kind: Kind, text: string): string | null {
  if (kind !== 'python') return jsonString(parseJsonObject(text, `the ${kind} manifest`).name, `the name of the ${kind} manifest`);
  const project = /^\[project\]\n([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(text)?.[1];
  return project === undefined ? null : /^name = "([^"]*)"$/m.exec(project)?.[1] ?? null;
}

for (const { directory, kind, name, product, runtime } of PACKAGES) {
  test(`${directory} holds the ${kind} package ${name} and config/release.json releases it from there (HR-98)`, () => {
    const manifest = join(repository, directory, MANIFEST[kind]);
    assert.ok(existsSync(manifest), `${directory}/${MANIFEST[kind]} is missing`);
    assert.equal(manifestName(kind, readFileSync(manifest, 'utf8')), name, `the name of ${directory}/${MANIFEST[kind]}`);
    const entries = released.filter(item => item.name === name && item.kind === RELEASED_KIND[kind]);
    assert.deepEqual(entries, [{ kind: RELEASED_KIND[kind], directory, name, product, runtime }], `the entry of ${name} in config/release.json`);
  });
}

for (const { directory, kind, name } of NATIVE) {
  test(`${directory} holds the native ${kind} package ${name} (HR-98)`, () => {
    assert.equal(manifestName(kind, readFileSync(join(repository, directory, MANIFEST[kind]), 'utf8')), name, `the name of ${directory}/${MANIFEST[kind]}`);
  });
}

test('packages/ holds only the packages of HR-98', () => {
  const manifests = execFileSync('git', ['ls-files', '-z', 'packages'], { cwd: repository, encoding: 'utf8' })
    .split('\0').filter((path) => /\/(package\.json|composer\.json|pyproject\.toml)$/.test(path)).map((path) => path.slice(0, path.lastIndexOf('/')));
  assert.deepEqual([...new Set(manifests)].sort(), [...PACKAGES, ...NATIVE].map(item => item.directory).sort());
});
