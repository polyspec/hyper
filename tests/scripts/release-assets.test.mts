// Tests the release archives of the template release that config/release-assets.json pins (H14.1-7, H23.11, H23.11-2): the
// native template extension is built from the php-ext archive, not from a copy of the template repository, and Composer
// reads the php zip from an artifact repository. `make hyper-install` downloads both with `make release-assets-fetch` of kit
// (K140), which checks their sha256 and unpacks the php-ext archive, and `make ext` builds the unpacked sources offline
// with phpize, configure and make, so no build reads scripts or sources of the template repository.
import { kitTool } from './kit-tools.mts';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { type JsonObject, jsonObjects, jsonString, parseJsonObject } from '../../scripts/json.mts';
import { dryRun } from './make-dry-run.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

/** The entries of config/release-assets.json (schema release-assets.schema.json of kit). */
const entries = (): JsonObject[] => jsonObjects(parseJsonObject(read('config/release-assets.json'), 'config/release-assets.json').assets, 'config/release-assets.json assets');

test('config/release-assets.json pins the php-ext and the php zips of one template release, the php-ext one unpacked (H23.11-2)', () => {
  const RELEASE = 'https://github.com/polyspec/template/releases/download/v{version}';
  const pinned = entries().filter(({ name }) => name === 'template-php-ext' || name === 'template-php');
  assert.deepEqual(pinned.map(({ name, url, directory, unpack }) => ({ name, url, directory, unpack })), [
    { name: 'template-php-ext', url: `${RELEASE}/polyspec-template-php-ext-php-{version}.zip`, directory: 'var/products', unpack: 'var/products/template-ext' },
    { name: 'template-php', url: `${RELEASE}/polyspec-template-php-{version}.zip`, directory: 'var/products/template-php', unpack: undefined },
  ], 'the entries are not the php-ext and php zips of the template release in their directories');
  assert.equal(new Set(pinned.map(({ version }) => version)).size, 1, 'the php-ext and php zips name different template releases');
});

test('the own downloader of the template assets is gone (H23.11-2)', () => {
  for (const file of ['scripts/template-assets.mts', 'config/template-assets.json']) assert.equal(existsSync(path.join(ROOT, file)), false, `${file} is still there`);
});

test('TEMPLATE_TAG of the Makefile reads the version of the template-php entry, its one declaration (H23.11-2)', () => {
  const version = jsonString(entries().find(({ name }) => name === 'template-php')?.version, 'the version of template-php');
  assert.match(read('Makefile'), /^TEMPLATE_TAG = v\$\(shell \$\(NODE\) \$\(KIT\)\/release-assets\.\$\(KIT_EXT\) version template-php\)$/m);
  const lines = dryRun('template-tag', { variables: ['TEMPLATE_REPOSITORY=/nonexistent/hyper-template'] });
  assert.ok(lines.some((line) => line.includes(`'refs/tags/v${version}^{commit}'`)), lines.join('\n'));
});

test('make ext builds the unpacked php-ext archive offline and runs no copy of the template repository (H14.1-7)', () => {
  const lines = dryRun('ext');
  assert.ok(lines.some((line) => /node scripts\/build-template-ext\.mts /.test(line)), `ext does not build the archive: ${lines.join('\n')}`);
  assert.deepEqual(lines.filter((line) => /copy-template|products\/template|template-tag/.test(line)), [], 'ext reads the template repository');
  assert.deepEqual(lines.filter((line) => /\b(curl|fetch)\b|gh release/.test(line)), [], 'ext downloads: only make hyper-install downloads (HR-89)');
});

test('make hyper-install fetches the release archives through $(ONLINE) before Composer reads the artifact repository (H23.11-2)', () => {
  const lines = dryRun('hyper-install');
  const fetches = lines.filter((line) => line.includes('release-assets.mts'));
  assert.deepEqual(fetches, [`env -u npm_config_offline -u COMPOSER_DISABLE_NETWORK ${path.join(ROOT, 'var/tools/bin/node')} ${kitTool('release-assets')} fetch`], lines.join('\n'));
  const [fetch] = fetches;
  assert.ok(fetch !== undefined && lines.indexOf(fetch) < lines.findIndex((line) => /composer install/.test(line)), 'Composer reads the artifact repository before make hyper-install fetched it');
});

test('the template repository is not copied any more, and PHPStan reads no stub of the template extension (H14.1-7, H25.60)', () => {
  assert.doesNotMatch(read('Makefile'), /copy-template/);
  // H25.60: the PHP server holds no branch on the template extension, so PHPStan scans no stub of it.
  assert.doesNotMatch(read('packages/server/php/phpstan.neon'), /template-ext|polyspec_template\.stub/);
});
