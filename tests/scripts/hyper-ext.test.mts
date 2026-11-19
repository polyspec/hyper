// Tests `make hyper-ext` (H35.25): the PHP server calls the rules of the core through the extension polyspec_hyper
// (HY-133.2), so a development checkout builds it from packages/php/native through the cargo of the link script and the
// PHP tests and the session workers load it from build/hyper-ext.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dryRun } from './make-dry-run.mts';
import { treeWithoutReleaseRecipes } from './release-recipes-tree.mts';
import { COMMANDS, HYPER_EXT } from './session-workers.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('hyper-ext builds packages/php/native through the cargo of the link script into build/hyper-ext (H35.25)', () => {
  const lines = dryRun('hyper-ext').join('\n');
  assert.match(lines, /link\.m[jt]s cargo \S+ build --locked --offline -p polyspec-hyper-php-ext/u, lines);
  assert.match(lines, /publish\.mts directory build\/hyper-ext\.next-\S+ build\/hyper-ext$/mu, lines);
});

// The PHP tests load the extension of the tests, built with the feature fault-test into its own directory, so that the
// fault cases of PHP arm the fault points of http-form (H35.11-3); the session workers load the release extension.
const HYPER_EXT_TEST = 'build/hyper-ext-test/polyspec_hyper.so';

test('hyper-test-php builds the extension of the tests and loads it in both PHPUnit runs (H35.25, H35.11-3)', () => {
  const lines = dryRun('hyper-test-php').join('\n');
  assert.match(lines, /polyspec-hyper-php-ext --features fault-test/u, lines);
  assert.match(lines, /publish\.mts directory build\/hyper-ext-test\.next-\S+ build\/hyper-ext-test$/mu, lines);
  const runs = lines.split('\n').filter((line) => line.includes('phpunit --cwd'));
  assert.ok(runs.length > 0, lines);
  // The recipe names the absolute path of the library, as every extension that PHP loads (PHP_SERVER_EXTENSIONS).
  for (const run of runs) {
    assert.match(run, new RegExp(`--php-extension /\\S*/${HYPER_EXT_TEST.replaceAll('.', '\\.')}( |$)`, 'u'), run);
    assert.doesNotMatch(run, new RegExp(`/${HYPER_EXT.replaceAll('.', '\\.')}( |$)`, 'u'), run);
  }
});

test('hyper-install builds the extension after it writes the sources of the bindings (H35.25)', () => {
  const steps = dryRun('hyper-install')
    .map((line) => /--no-print-directory (\S+)/u.exec(line)?.[1])
    .filter((step) => step !== undefined);
  assert.ok(steps.indexOf('bindings') < steps.indexOf('hyper-ext'), `bindings runs before hyper-ext: ${steps.join(' ')}`);
});

test('hyper-ext of a tree without packages/release.mk writes it first and reads LLVM_MAJOR and LLVM_ROOT from it (H35.16-3)', (t) => {
  const { tree, variables } = treeWithoutReleaseRecipes(t, 'hyper-ext-');
  const lines = dryRun('hyper-ext', { cwd: tree, variables }).join('\n');
  assert.ok(existsSync(path.join(tree, 'packages/release.mk')), `make wrote packages/release.mk before it read hyper-ext:\n${lines}`);
  const major = /"llvm": \{[^}]*"version": "(\d+)"/u.exec(readFileSync(path.join(ROOT, 'config/toolchain.json'), 'utf8'))?.[1];
  assert.ok(major !== undefined, 'config/toolchain.json pins llvm.version');
  assert.match(lines, new RegExp(`LIBCLANG_PATH=\\S*llvm[@-]${major}/lib CLANG_PATH=\\S*llvm[@-]${major}/bin/clang `, 'u'), lines);
});

test('the PHP session worker loads the extension (H35.25)', () => {
  assert.ok(COMMANDS.php.prefix.some((word) => word.startsWith('-dextension=') && word.endsWith(HYPER_EXT)), COMMANDS.php.prefix.join(' '));
});
