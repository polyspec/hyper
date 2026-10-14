// Tests the release assets of the template tag that config/template-assets.json pins (H14.1-7, H23.11): the native template
// extension is built from the php-ext asset, not from a copy of the template repository, and Composer reads the php zip
// from an artifact repository. `make install` downloads both through $(ONLINE) and verifies them by their pinned sha256,
// and `make ext` builds the unpacked asset offline with phpize, configure and make, so no build reads scripts or sources
// of the template repository.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { dryRun } from './make-dry-run.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');
const tagOf = () => /^TEMPLATE_TAG := (\S+)$/m.exec(read('Makefile'))?.[1];

test('config/template-assets.json names the php-ext and the php assets of the template tag with their pinned sha256 (H14.1-7, H23.11)', () => {
  const config = JSON.parse(read('config/template-assets.json'));
  const TAG = tagOf();
  assert.equal(config.tag, TAG, 'the tag of config/template-assets.json is not TEMPLATE_TAG of the Makefile');
  const version = TAG.slice(1);
  assert.deepEqual(Object.keys(config.assets).sort(), ['php', 'php-ext']);
  assert.equal(config.assets['php-ext'].name, `polyspec-template-php-ext-php-${version}.zip`, 'the asset name is not the kit name of the php-ext asset');
  assert.equal(config.assets.php.name, `polyspec-template-php-${version}.zip`, 'the asset name is not the kit name of the php asset');
  for (const asset of Object.values(config.assets)) assert.match(asset.sha256, /^[0-9a-f]{64}$/);
});

test('make ext builds the unpacked release asset offline and runs no copy of the template repository (H14.1-7)', () => {
  const lines = dryRun('ext');
  assert.ok(lines.some((line) => /node scripts\/template-assets\.mjs build /.test(line)), `ext does not build the asset: ${lines.join('\n')}`);
  assert.deepEqual(lines.filter((line) => /copy-template|products\/template|template-tag/.test(line)), [], 'ext reads the template repository');
  assert.deepEqual(lines.filter((line) => /\b(curl|fetch)\b|gh release/.test(line)), [], 'ext downloads: only make install downloads (HY-89)');
});

test('make install fetches the template assets through $(ONLINE) and verifies them (H14.1-7, H23.11)', () => {
  const lines = dryRun('install');
  const fetch = lines.filter((line) => /node scripts\/template-assets\.mjs fetch/.test(line));
  assert.equal(fetch.length, 1, lines.join('\n'));
  assert.match(fetch[0], /^env -u npm_config_offline -u COMPOSER_DISABLE_NETWORK node scripts\/template-assets\.mjs fetch/);
});

test('the template repository is not copied any more, and the stub of PHPStan reads the unpacked asset (H14.1-7)', () => {
  assert.doesNotMatch(read('Makefile'), /copy-template/);
  assert.match(read('packages/hyper-server-php/phpstan.neon'), /var\/products\/template-ext\/src\/polyspec_template\.stub\.php/);
});
