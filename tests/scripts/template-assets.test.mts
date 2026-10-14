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

import { dryRun } from './make-dry-run.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');
const tagOf = (): string => {
  const tag = /^TEMPLATE_TAG := (\S+)$/m.exec(read('Makefile'))?.[1];
  if (tag === undefined) throw new Error('the Makefile declares no TEMPLATE_TAG');
  return tag;
};

test('config/template-assets.json pins the php-ext and the php assets of the template tag by URL, sha256 and destination (H14.1-7, H23.11)', () => {
  const config = JSON.parse(read('config/template-assets.json')) as { schema: number; assets: { url: string; sha256: string; destination: string }[] };
  const TAG = tagOf();
  const version = TAG.slice(1);
  const release = `https://github.com/polyspec/template/releases/download/${TAG}`;
  assert.equal(config.schema, 1);
  assert.deepEqual(config.assets.map(({ url, destination }) => ({ url, destination })), [
    { url: `${release}/polyspec-template-php-ext-php-${version}.zip`, destination: `var/products/polyspec-template-php-ext-php-${version}.zip` },
    { url: `${release}/polyspec-template-php-${version}.zip`, destination: `var/products/template-php/polyspec-template-php-${version}.zip` },
  ], 'the assets are not the kit names of the php-ext and php assets of TEMPLATE_TAG, or not in their destinations');
  for (const asset of config.assets) assert.match(asset.sha256, /^[0-9a-f]{64}$/);
});

test('make ext builds the unpacked release asset offline and runs no copy of the template repository (H14.1-7)', () => {
  const lines = dryRun('ext');
  assert.ok(lines.some((line) => /node scripts\/template-assets\.mts build /.test(line)), `ext does not build the asset: ${lines.join('\n')}`);
  assert.deepEqual(lines.filter((line) => /copy-template|products\/template|template-tag/.test(line)), [], 'ext reads the template repository');
  assert.deepEqual(lines.filter((line) => /\b(curl|fetch)\b|gh release/.test(line)), [], 'ext downloads: only make install downloads (HY-89)');
});

test('make install fetches the template assets through $(ONLINE) and unpacks the php-ext asset offline (H14.1-7, H23.11)', () => {
  const lines = dryRun('install');
  const steps = lines.filter((line) => /node scripts\/template-assets\.mts /.test(line));
  assert.deepEqual(steps, [
    'env -u npm_config_offline -u COMPOSER_DISABLE_NETWORK node scripts/template-assets.mts fetch',
    'node scripts/template-assets.mts unpack',
  ], lines.join('\n'));
  const unpack = steps[1];
  assert.ok(unpack !== undefined, 'make install runs no unpack step');
  assert.ok(lines.indexOf(unpack) < lines.findIndex((line) => /composer install/.test(line)), 'Composer reads the artifact repository before make install fetched it');
});

test('the template repository is not copied any more, and the stub of PHPStan reads the unpacked asset (H14.1-7)', () => {
  assert.doesNotMatch(read('Makefile'), /copy-template/);
  assert.match(read('packages/hyper-server-php/phpstan.neon'), /var\/products\/template-ext\/src\/polyspec_template\.stub\.php/);
});
