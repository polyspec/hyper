// Tests the release archives of the template release that config/release-assets.json pins (H14.1-7, H23.11, H23.11-2): the
// native template extension is built from the php-ext archive, not from a copy of the template repository; Composer fetches
// the php zip itself from its package repository (H27.44). `make hyper-install` downloads the php-ext archive with
// `make release-assets-fetch` of kit (K140), which checks its sha256 and unpacks it, and `make ext` builds the unpacked
// sources offline with phpize, configure and make, so no build reads scripts or sources of the template repository.
import { kitTool } from './kit-tools.mts';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { type JsonObject, jsonObjects, jsonString, parseJsonObject } from '../../scripts/json.mts';
import { dryRun } from './make-dry-run.mts';
import { mainTools } from './main-tools.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

/** The entries of config/release-assets.json (schema release-assets.schema.json of kit). */
const entries = (): JsonObject[] => jsonObjects(parseJsonObject(read('config/release-assets.json'), 'config/release-assets.json').assets, 'config/release-assets.json assets');

test('config/release-assets.json pins only the php-ext zip of the template release, unpacked (H23.11-2, H27.44)', () => {
  const RELEASE = 'https://github.com/polyspec/template/releases/download/v{version}';
  assert.deepEqual(entries().map(({ name, url, directory, unpack }) => ({ name, url, directory, unpack })), [
    { name: 'template-php-ext', url: `${RELEASE}/polyspec-template-php-ext-php-{version}.zip`, directory: 'var/products', unpack: 'var/products/template-ext' },
  ], 'the entries are not the php-ext zip of the template release in its directories');
});

test('the own downloader of the template assets is gone (H23.11-2)', () => {
  for (const file of ['scripts/template-assets.mts', 'config/template-assets.json']) assert.equal(existsSync(path.join(ROOT, file)), false, `${file} is still there`);
});

test('TEMPLATE_TAG of the Makefile reads the version of the template-php-ext entry, its one declaration (H23.11-2, H27.44)', () => {
  const version = jsonString(entries().find(({ name }) => name === 'template-php-ext')?.version, 'the version of template-php-ext');
  assert.match(read('Makefile'), /^TEMPLATE_TAG = v\$\(shell \$\(NODE\) \$\(KIT\)\/release-assets\.\$\(KIT_EXT\) version template-php-ext\)$/m);
  const lines = dryRun('template-tag', { variables: ['TEMPLATE_REPOSITORY=/nonexistent/hyper-template'] });
  assert.ok(lines.some((line) => line.includes(`'refs/tags/v${version}^{commit}'`)), lines.join('\n'));
});

test('make ext builds the unpacked php-ext archive offline and runs no copy of the template repository (H14.1-7)', () => {
  const lines = dryRun('ext');
  assert.ok(lines.some((line) => /node scripts\/build-template-ext\.mts /.test(line)), `ext does not build the archive: ${lines.join('\n')}`);
  assert.deepEqual(lines.filter((line) => /copy-template|products\/template|template-tag/.test(line)), [], 'ext reads the template repository');
  assert.deepEqual(lines.filter((line) => /\b(curl|fetch)\b|gh release/.test(line)), [], 'ext downloads: only make hyper-install downloads (HR-89)');
});

test('make hyper-install fetches the php-ext archive through $(ONLINE) once (H23.11-2)', () => {
  // The recipe of the main checkout: KIT_WORKTREE= keeps a run in a worktree from the worktree refusals of kit (K519, K780),
  // and a worktree runs the tools of its main checkout (HR-81).
  const lines = dryRun('hyper-install', { variables: ['KIT_WORKTREE='] });
  const fetches = lines.filter((line) => line.includes(kitTool('release-assets')));
  assert.deepEqual(fetches, [`env -u npm_config_offline -u COMPOSER_DISABLE_NETWORK ${path.join(mainTools(ROOT), 'bin/node')} ${kitTool('release-assets')} fetch`], lines.join('\n'));
});

test('the template repository is not copied any more, and PHPStan reads no stub of the template extension (H14.1-7, H25.60)', () => {
  assert.doesNotMatch(read('Makefile'), /copy-template/);
  // H25.60: the PHP server holds no branch on the template extension, so PHPStan scans no stub of it.
  assert.doesNotMatch(read('packages/server/php/phpstan.neon'), /template-ext|polyspec_template\.stub/);
});
