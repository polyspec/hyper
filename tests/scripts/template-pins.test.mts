// Tests the template pins of this repository (HR-70, HR-80, H14.1-7): `make template-tag` fails for a template checkout
// without the tag TEMPLATE_TAG; workspaces resolve the same installed template package, including a source link.
// Composer release declarations name the verified PHP zip and PHPStan reads the PHP library without an extension stub.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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

test('workspaces resolve the same installed template package through native source links or an installation', () => {
  requireBuilt('hyper-install', 'node_modules/@polyspec/template/package.json');
  assert.equal(readObject('node_modules/@polyspec/template/package.json').name, '@polyspec/template');
  const render = createRequire(join(repository, 'package.json')).resolve('@polyspec/template/render');
  for (const workspace of ['packages/client', 'packages/server/ts', 'packages/build']) {
    assert.equal(createRequire(join(repository, workspace, 'package.json')).resolve('@polyspec/template/render'), render, workspace);
  }
});

test('Composer release declarations pin the PHP zip and PHPStan reads no extension stub', () => {
  const required = jsonObject(readObject('composer.json').require, 'composer.json require')['polyspec/template'];
  assert.ok(required !== undefined, 'composer.json requires no polyspec/template');
  const version = jsonString(required, 'composer.json require polyspec/template');
  assert.match(version, /^\d+\.\d+\.\d+$/, 'composer.json requires an exact template version');
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
  assert.doesNotMatch(readFileSync('packages/server/php/phpstan.neon', 'utf8'), /polyspec_template\.stub\.php/);
});
