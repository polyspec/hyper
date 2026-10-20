// Tests the template pins of this repository (HR-70, HR-80, H14.1-7): `make template-tag` fails for a template checkout
// without the tag TEMPLATE_TAG, which the full-run key names; npm installs the template package as one copy inside the
// checkout; Composer installs the template PHP package from the verified zip of the template release in an artifact repository; and PHPStan reads the stub
// of the unpacked php-ext archive (config/release-assets.json), not a copy of the template repository.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
import { jsonObject, jsonObjects, jsonString, parseJsonObject } from '../../scripts/json.mts';
import { requireBuilt } from './requires.mts';

const repository = resolve('.');
/** An entry of config/release-assets.json. */
interface Entry { name: string; version: string; url: string; directory: string }
const ASSETS = 'config/release-assets.json';
const entries = (): Entry[] => jsonObjects(parseJsonObject(readFileSync(join(repository, ASSETS), 'utf8'), ASSETS).assets, `${ASSETS} assets`).map((entry, index) => {
  const field = (key: string): string => jsonString(entry[key], `${ASSETS} assets[${index}] ${key}`);
  return { name: field('name'), version: field('version'), url: field('url'), directory: field('directory') };
});
// The JSON object of the file `file`.
const readObject = (file: string) => parseJsonObject(readFileSync(file, 'utf8'), file);
// The tag TEMPLATE_TAG of the Makefile, the tag of the version of the entry template-php of config/release-assets.json,
// the one declaration of the template release (HR-80, H23.11-2).
function templateTag(): string {
  const version = entries().find(({ name }) => name === 'template-php')?.version;
  if (version === undefined) throw new Error('config/release-assets.json declares no entry template-php');
  return `v${version}`;
}
const TAG = templateTag();

// A template repository with a tracked file, and the tag TAG at its commit unless `tagged` is false.
function templateRepository(t: TestContext, tagged = true) {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-template-repository-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const files = {
    'packages/template-ts/package.json': JSON.stringify({ name: '@polyspec/template', version: '0.0.1' }),
    'packages/template-php/composer.json': '{"name": "polyspec/template"}\n',
    'packages/template-php-ext/src/polyspec_template.stub.php': '<?php\n',
    'package-lock.json': '{}\n',
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), text);
  }
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=hyper', '-c', 'user.email=hyper@localhost', '-C', directory, ...args], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  if (tagged) git('tag', TAG);
  return { directory };
}

test('make template-tag fails for a template checkout without the tag TEMPLATE_TAG and passes with it', (t) => {
  const make = (template: { directory: string }) => spawnSync('make', ['--no-print-directory', 'template-tag', `TEMPLATE_REPOSITORY=${template.directory}`], {
    cwd: repository, encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL', 'MAKEOVERRIDES'].includes(name))),
  });
  const untagged = templateRepository(t, false);
  const missing = make(untagged);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, new RegExp(`template-tag: \\S+ has no tag ${TAG.replaceAll('.', '\\.')}: expected the tag ${TAG.replaceAll('.', '\\.')}, actual tags: \\n`));
  const tagged = templateRepository(t);
  const found = make(tagged);
  assert.equal(found.status, 0, found.stderr);
});

test('npm installs the template package as one copy inside this checkout', () => {
  requireBuilt('hyper-install', 'node_modules/@polyspec/template/package.json');
  const path = 'node_modules/@polyspec/template';
  assert.equal(lstatSync(join(repository, path)).isSymbolicLink(), false, path);
  assert.equal(lstatSync(join(repository, path)).isDirectory(), true, path);
  assert.ok(realpathSync(join(repository, path)).startsWith(`${repository}/`), path);
  // The packages of the workspace resolve the root package through the overrides, so they hold no copy of their own.
  for (const nested of ['packages/client/node_modules/@polyspec/template', 'packages/server/ts/node_modules/@polyspec/template']) {
    assert.equal(existsSync(join(repository, nested)), false, nested);
  }
});

test('Composer installs the template PHP package from the zip of the template release, and PHPStan reads the stub of the unpacked php-ext asset', () => {
  const required = jsonObject(readObject('packages/server/php/composer.json').require, 'packages/server/php/composer.json require')['polyspec/template'];
  assert.ok(required !== undefined, 'packages/server/php requires no polyspec/template');
  const version = jsonString(required, 'packages/server/php/composer.json require polyspec/template');
  assert.match(version, /^\d+\.\d+\.\d+$/, 'packages/server/php requires an exact template version');
  // config/release-assets.json pins the zip; make hyper-install checks it by its sha256 and writes it into var/products/template-php,
  // the artifact repository of both Composer projects, so no manifest copies the metadata of the template package.
  const zip = `polyspec-template-php-${version}.zip`;
  const pinned = entries().filter(({ directory }) => directory === 'var/products/template-php');
  assert.deepEqual(pinned.map(({ url, version }) => url.replaceAll('{version}', version).split('/').pop()), [zip]);
  for (const manifest of ['composer.json', 'examples/board/composer.json']) {
    const { repositories, require } = readObject(manifest);
    assert.equal(jsonObject(require, `${manifest} require`)['polyspec/template'], version, manifest);
    const directory = relative(dirname(resolve(manifest)), join(repository, 'var/products/template-php'));
    assert.deepEqual(jsonObjects(repositories, `${manifest} repositories`).filter((item) => item.type !== 'path'), [{ type: 'artifact', url: directory }], `${manifest}: the template zip comes from the artifact repository ${directory}`);
    const lockFile = manifest.replace(/\.json$/, '.lock');
    const entry = jsonObjects(readObject(lockFile).packages, `${lockFile} packages`).find(({ name }) => name === 'polyspec/template');
    assert.ok(entry !== undefined, `${manifest}: the lock has no polyspec/template`);
    assert.equal(entry.version, version, manifest);
    const dist = jsonObject(entry.dist, `${lockFile} polyspec/template dist`);
    assert.equal(dist.type, 'zip', manifest);
    assert.equal(dist.url, `${directory}/${zip}`, manifest);
    assert.match(jsonString(dist.shasum, `${lockFile} polyspec/template dist shasum`), /^[0-9a-f]{40}$/, `${manifest}: the lock pins the zip by its sha1`);
  }
  const scanned = /scanFiles:\n\s+- (\S+)/.exec(readFileSync('packages/server/php/phpstan.neon', 'utf8'))?.[1];
  assert.ok(scanned !== undefined, 'packages/server/php/phpstan.neon scans no file');
  assert.equal(resolve('packages/server/php', scanned), join(repository, 'var/products/template-ext/src/polyspec_template.stub.php'));
});
