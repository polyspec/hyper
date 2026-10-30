// Tests the native template extension (H14.1-7, H27.45, H27.51): the recipe of template-ext builds polyspec/template-php-ext of
// the template release with PIE from the Composer repository of that release (packages.json), whose dist carries the sha1 of
// the php-ext zip, so hyper pins no release archive of its own and builds no copy of the template repository.
// `make hyper-install` runs `make template-ext` under $(ONLINE); `make ext` of the checks only requires the built library and runs offline.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('make template-ext builds polyspec/template-php-ext of TEMPLATE_VERSION with PIE in an empty folder from the Composer repository of the release (H27.45, H27.51)', () => {
  const version = variable('TEMPLATE_VERSION');
  const lines = dryRun('template-ext');
  const text = lines.join('\n');
  const packages = `https://github.com/polyspec/template/releases/download/v${version}/packages.json`;
  const escape = (value: string) => value.replaceAll(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const work = `${ROOT}/var/pie/polyspec/template-php-ext`;
  // PIE keeps one Composer project per target PHP in its working directory and never undoes repository:add, so each run
  // starts in an empty folder of the package and names it as PIE_WORKING_DIRECTORY of both PIE commands.
  assert.match(text, new RegExp(`rm -rf ${escape(work)} && mkdir -p ${escape(work)}`), text);
  const pie = lines.filter((line) => /\/mise\/shims\/pie /.test(line));
  assert.equal(pie.length, 2, text);
  for (const line of pie) {
    assert.match(line, new RegExp(`^env -u npm_config_offline -u COMPOSER_DISABLE_NETWORK env PIE_WORKING_DIRECTORY=${escape(work)} \\S+/var/tools/mise/shims/pie `), line);
    assert.match(line, / --no-interaction$/, line);
  }
  assert.match(pie[0] ?? '', new RegExp(` repository:add composer ${escape(packages)} --no-interaction$`));
  assert.match(pie[1] ?? '', new RegExp(` build polyspec/template-php-ext:${escape(version)} --no-interaction$`));
  // pie install writes into the PHP of the machine, and kit has no pie-build any more (kit K931).
  assert.deepEqual(lines.filter((line) => /\/pie-build\.|\bpie install\b|mise install/.test(line)), [], text);
  // The recipe takes the one library that PIE recorded with scripts/pie-binary.mts, fails with its status and publishes a file.
  assert.match(text, new RegExp(`binary=\\$\\(\\S+ scripts/pie-binary\\.mts ${escape(work)} polyspec/template-php-ext\\) \\|\\| exit \\$\\?; \\\\\n\\s*mkdir -p build/ext\\.next-`), text);
});

test('make hyper-install builds the extension through make template-ext once (H27.45)', () => {
  const lines = dryRun('hyper-install', { variables: ['KIT_WORKTREE='] });
  // A recursive make prints $(MAKE) as it was started, a bare make or its path, and kit-bootstrap.mk adds KIT and KIT_EXT to
  // it, so the case judges the words of the command: a make by its base name, and template-ext as its last word.
  const recursive = lines.filter((line) => {
    const words = line.trim().split(/\s+/);
    return path.basename(words[0] ?? '') === 'make' && words.at(-1) === 'template-ext';
  });
  assert.equal(recursive.length, 1, lines.join('\n'));
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
