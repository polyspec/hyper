// Tests that the asset build, the template build and the server build read the template packages that
// @polyspec/hyper-build requires, @polyspec/template and @polyspec/template-compiler, by their package names (HR-70): npm
// installs them from the tarballs of the template release that the root package.json names by their URLs and
// package-lock.json pins by their integrity, and no build takes a template directory.
import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { templatePlugin } from '../../packages/build/lib/template-files.mjs';
import { type JsonObject, jsonObject, jsonString, parseJsonObject } from '../../scripts/json.mts';
import { requireBuilt } from './requires.mts';

const repository = resolve('.');
const PACKAGES = ['@polyspec/template', '@polyspec/template-compiler'];
const read = (file: string): JsonObject => parseJsonObject(readFileSync(join(repository, file), 'utf8'), file);
// The object `key` of the JSON object of `file`.
const member = (file: string, key: string): JsonObject => jsonObject(read(file)[key], `${file} ${key}`);

test('bundles the template render runtime of a client from the installed template package', async () => {
  requireBuilt('hyper-install', 'node_modules/@polyspec/template/package.json');
  const result = await build({
    stdin: { contents: "export { Engine } from '@polyspec/template/render';", resolveDir: repository, sourcefile: 'client.ts', loader: 'ts' },
    bundle: true,
    format: 'esm',
    write: false,
    metafile: true,
    logLevel: 'error',
    plugins: [templatePlugin()],
  });
  const inputs = Object.keys(result.metafile.inputs).map((input) => resolve(input));
  const render = realpathSync(fileURLToPath(import.meta.resolve('@polyspec/template/render')));
  assert.ok(inputs.includes(render), inputs.join('\n'));
});

test('release declarations pin template tarballs while installed source packages keep their identity', () => {
  requireBuilt('hyper-install', ...PACKAGES.map((name) => `node_modules/${name}/package.json`));
  const dependencies = member('package.json', 'dependencies');
  const overrides = member('package.json', 'overrides');
  const packages = member('package-lock.json', 'packages');
  const version = jsonString(member('packages/client/package.json', 'dependencies')['@polyspec/template'], 'packages/client/package.json @polyspec/template');
  assert.match(version, /^\d+\.\d+\.\d+$/, 'packages/client requires an exact template version');
  assert.equal(member('packages/server/ts/package.json', 'dependencies')['@polyspec/template'], version);
  for (const name of PACKAGES) assert.equal(member('packages/build/package.json', 'dependencies')[name], version, name);
  for (const name of PACKAGES) {
    const tarball = `https://github.com/polyspec/template/releases/download/v${version}/${name.slice(1).replace('/', '-')}-npm-${version}.tgz`;
    assert.equal(dependencies[name], tarball, name);
    const entry = jsonObject(packages[`node_modules/${name}`], `package-lock.json node_modules/${name}`);
    assert.equal(entry.resolved, tarball, name);
    assert.equal(entry.version, version, name);
    assert.match(jsonString(entry.integrity, `${name} integrity`), /^sha512-/, `${name} is pinned by its integrity`);
    assert.equal(read(`node_modules/${name}/package.json`).name, name, name);
  }
  // The packages of the workspace require the exact version, which the root resolves to the same tarball.
  for (const name of PACKAGES) assert.equal(overrides[name], `$${name}`, name);
  assert.match(readFileSync(join(repository, '.npmrc'), 'utf8'), /^allow-remote=root$/m);
});
