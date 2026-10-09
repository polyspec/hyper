// Tests that the native template extension of this repository is built from the php-ext release asset of the template
// tag that config/template-ext.json names (H14.1-7), and not from a copy of the template repository: `make install`
// downloads the asset through $(ONLINE) and verifies it by its pinned sha256, and `make ext` builds the unpacked asset
// offline with phpize, configure and make, so no build reads scripts or sources of the template repository.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { dryRun } from './make-dry-run.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');
const tagOf = () => /^TEMPLATE_TAG := (\S+)$/m.exec(read('Makefile'))?.[1];

test('config/template-ext.json names the php-ext asset of the template tag with its pinned sha256 (H14.1-7)', () => {
  const config = JSON.parse(read('config/template-ext.json'));
  const TAG = tagOf();
  assert.equal(config.tag, TAG, 'the tag of config/template-ext.json is not TEMPLATE_TAG of the Makefile');
  const version = TAG.slice(1);
  assert.equal(config.asset, `polyspec-template-php-ext-php-${version}.zip`, 'the asset name is not the kit name of the php-ext asset');
  assert.match(config.sha256, /^[0-9a-f]{64}$/);
});

test('make ext builds the unpacked release asset offline and runs no copy of the template repository (H14.1-7)', () => {
  const lines = dryRun('ext');
  assert.ok(lines.some((line) => /node scripts\/template-ext\.mjs build /.test(line)), `ext does not build the asset: ${lines.join('\n')}`);
  assert.deepEqual(lines.filter((line) => /copy-template|products\/template|template-tag/.test(line)), [], 'ext reads the template repository');
  assert.deepEqual(lines.filter((line) => /\b(curl|fetch)\b|gh release/.test(line)), [], 'ext downloads: only make install downloads (HY-89)');
});

test('make install fetches the php-ext asset through $(ONLINE) and verifies it (H14.1-7)', () => {
  const lines = dryRun('install');
  const fetch = lines.filter((line) => /node scripts\/template-ext\.mjs fetch/.test(line));
  assert.equal(fetch.length, 1, lines.join('\n'));
  assert.match(fetch[0], /^env -u npm_config_offline -u COMPOSER_DISABLE_NETWORK node scripts\/template-ext\.mjs fetch/);
});

test('the template repository is not copied any more, and the stub of PHPStan reads the unpacked asset (H14.1-7)', () => {
  assert.doesNotMatch(read('Makefile'), /copy-template/);
  assert.match(read('packages/hyper-server-php/phpstan.neon'), /var\/products\/template-ext\/src\/polyspec_template\.stub\.php/);
});
