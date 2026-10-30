// Tests the native template extension (H14.1-7, H27.45): PIE builds polyspec/template-php-ext of the template release from
// the Composer repository of that release (packages.json), whose dist carries the sha1 of the php-ext zip, so hyper pins no
// release archive of its own and builds no copy of the template repository. `make hyper-install` runs `make template-ext`
// under $(ONLINE); `make ext` of the checks only requires the built library and runs offline.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { dryRun } from './make-dry-run.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');
// The value of the simple variable `name` of the Makefile.
const variable = (name: string): string => {
  const value = new RegExp(`^${name} := (.+)$`, 'm').exec(read('Makefile'))?.[1];
  if (value === undefined) throw new Error(`the Makefile declares no ${name} :=`);
  return value;
};

test('hyper pins no release archive and holds no build of its own of the template extension (H23.11-2, H27.45)', () => {
  for (const file of ['config/release-assets.json', 'scripts/build-template-ext.mts', 'scripts/template-assets.mts', 'config/template-assets.json']) {
    assert.equal(existsSync(path.join(ROOT, file)), false, `${file} is still there`);
  }
  assert.doesNotMatch(read('Makefile'), /release-assets-fetch|release-assets\.\$\(KIT_EXT\)/);
});

test('make template-ext builds polyspec/template-php-ext of TEMPLATE_VERSION with PIE from the Composer repository of the release (H27.45)', () => {
  const version = variable('TEMPLATE_VERSION');
  const lines = dryRun('template-ext');
  const pie = lines.filter((line) => line.includes('mise/shims/pie '));
  const packages = `https://github.com/polyspec/template/releases/download/v${version}/packages.json`;
  assert.equal(pie.length, 2, lines.join('\n'));
  // The recipe installs http:pie of mise.toml with its locked checksum before it runs PIE, since a CI job installs only the
  // TOOLS of its matrix and install-tools of kit has no pie selector (H27.45-1).
  const install = lines.findIndex((line) => /^env -u npm_config_offline -u COMPOSER_DISABLE_NETWORK \S+\/var\/tools\/bin\/mise install --locked http:pie$/.test(line));
  assert.ok(install >= 0 && install < lines.indexOf(pie[0] ?? ''), lines.join('\n'));
  assert.match(pie[0] ?? '', new RegExp(`^PIE_WORKING_DIRECTORY=\\S+/var/pie env -u npm_config_offline -u COMPOSER_DISABLE_NETWORK \\S+ repository:add composer ${packages.replaceAll('.', '\\.')} --no-interaction$`));
  assert.match(pie[1] ?? '', new RegExp(`^PIE_WORKING_DIRECTORY=\\S+/var/pie env -u npm_config_offline -u COMPOSER_DISABLE_NETWORK \\S+ build polyspec/template-php-ext:${version.replaceAll('.', '\\.')} --no-interaction$`));
  assert.deepEqual(lines.filter((line) => /\/mise\/shims\/pie install\b/.test(line)), [], 'pie install would install the library into the PHP of the machine');
});

test('make hyper-install builds the extension through make template-ext once (H27.45)', () => {
  const lines = dryRun('hyper-install', { variables: ['KIT_WORKTREE='] });
  assert.equal(lines.filter((line) => /\/make .*--no-print-directory template-ext$/.test(line)).length, 1, lines.join('\n'));
});

test('make ext of the checks builds and downloads nothing (H14.1-7, HR-89)', () => {
  const lines = dryRun('ext');
  assert.deepEqual(lines.filter((line) => /\bpie\b|phpize|\b(curl|fetch)\b|gh release|composer/.test(line)), [], lines.join('\n'));
});

test('the template repository is not copied any more, and PHPStan reads no stub of the template extension (H14.1-7, H25.60)', () => {
  assert.doesNotMatch(read('Makefile'), /copy-template/);
  // H25.60: the PHP server holds no branch on the template extension, so PHPStan scans no stub of it.
  assert.doesNotMatch(read('packages/server/php/phpstan.neon'), /template-ext|polyspec_template\.stub/);
});
