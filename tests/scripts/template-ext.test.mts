// Tests the native template extension (H14.1-7, H27.45): the pie-build of kit (K915) builds polyspec/template-php-ext of the
// template release with PIE from the Composer repository of that release (packages.json), whose dist carries the sha1 of the
// php-ext zip, so hyper pins no release archive of its own and builds no copy of the template repository.
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

test('make template-ext builds polyspec/template-php-ext of TEMPLATE_VERSION with the pie-build of kit from the Composer repository of the release (H27.45, kit K915)', () => {
  const version = variable('TEMPLATE_VERSION');
  const lines = dryRun('template-ext');
  const packages = `https://github.com/polyspec/template/releases/download/v${version}/packages.json`;
  // pie-build of kit builds in an empty var/pie/<vendor/name> with the http:pie that make install-tools TOOLS=pie installed, so
  // the recipe names no working directory of PIE, installs no tool and runs PIE only through it.
  const build = lines.filter((line) => line.includes('/pie-build.'));
  assert.equal(build.length, 1, lines.join('\n'));
  assert.match(build[0] ?? '', new RegExp(`env -u npm_config_offline -u COMPOSER_DISABLE_NETWORK \\S+ \\S+/pie-build\\.m?[jt]s ${packages.replaceAll('.', '\\.')} polyspec/template-php-ext ${version.replaceAll('.', '\\.')}\\)`));
  assert.deepEqual(lines.filter((line) => /mise install|PIE_WORKING_DIRECTORY|var\/pie|\/mise\/shims\/pie\b/.test(line)), [], lines.join('\n'));
  // The recipe fails with the status of pie-build, takes the library from its line binary <path> and publishes only a file.
  assert.match(build[0] ?? '', /\) \|\| exit \$\?; \\$/, 'a failed pie-build does not end the recipe with its status');
  assert.match(lines.join('\n'), /sed -n 's\/\^binary \/\/p'/, 'the recipe takes the library from the line binary <path> of pie-build');
  assert.match(lines.join('\n'), /test -n "\$binary" && test -f "\$binary" \|\| \{[^}]*exit 1; \}; \\\n\s*mkdir -p build\/ext\.next-/, 'the recipe publishes the library only when pie-build named a file');
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
