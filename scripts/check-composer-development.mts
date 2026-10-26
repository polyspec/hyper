// HR-70, HR-79: inspect native development records; Composer alone resolves and writes them.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { jsonObject, jsonObjects, jsonString, parseJsonObject } from './json.mts';

const { values } = parseArgs({ options: { root: { type: 'string' } } });
assert.ok(values.root, '--root must name the development checkout');
const root = resolve(values.root);
const object = (file: string) => parseJsonObject(readFileSync(file, 'utf8'), file);
let checked = 0;
for (const directory of [root, join(root, 'examples/board')]) {
  for (const file of ['composer.local.json', 'composer.local.lock', 'vendor/composer/installed.json']) {
    assert.ok(existsSync(join(directory, file)), `${directory}/${file} is missing; make composer-development creates the native development installation`);
  }
  const manifest = object(join(directory, 'composer.local.json'));
  const packages = jsonObjects(object(join(directory, 'vendor/composer/installed.json')).packages, 'installed packages');
  const locked = jsonObjects(object(join(directory, 'composer.local.lock')).packages, 'development lock packages');
  const providers = jsonObjects(manifest.repositories, 'development repositories').filter((entry) => entry.type === 'path');
  assert.ok(providers.length > 0, `${directory}: no declared source provider`);
  for (const provider of providers) {
    const source = resolve(directory, jsonString(provider.url, 'provider source'));
    const declared = object(join(source, 'composer.json'));
    const name = jsonString(declared.name, 'source package name');
    const label = `${directory}: ${name}`;
    const installed = packages.find((entry) => entry.name === name);
    assert.ok(installed, `${label} has no native installed record`);
    if (declared.version !== undefined) assert.equal(installed.version, declared.version, `${label}: source version differs from installed version`);
    assert.deepEqual(installed.require, declared.require, `${label}: source requirements differ from installed requirements`);
    assert.deepEqual(installed.autoload, declared.autoload, `${label}: source autoload differs from installed autoload`);
    assert.equal(realpathSync(join(directory, 'vendor', name)), realpathSync(source), `${label}: installed path differs from source`);
    const lock = locked.find((entry) => entry.name === name);
    assert.ok(lock, `${label} has no native lock record`);
    assert.equal(lock.version, installed.version, `${label}: lock version differs from installed version`);
    const lockedDist = jsonObject(lock.dist, 'provider dist');
    const installedDist = jsonObject(installed.dist, 'installed provider dist');
    assert.equal(lockedDist.type, 'path', `${label}: lock source is not a native path repository`);
    assert.equal(installedDist.type, 'path', `${label}: installed source is not a native path repository`);
    for (const dist of [lockedDist, installedDist]) {
      assert.equal(realpathSync(resolve(directory, jsonString(dist.url, 'provider path'))), realpathSync(source), `${label}: native record names another source path`);
    }
    checked += 1;
  }
}
assert.ok(checked > 0);
console.log(`composer-development: ${checked} declared source packages match native installed records and locks`);
