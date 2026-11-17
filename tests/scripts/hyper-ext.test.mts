// Tests `make hyper-ext` (H35.25): the PHP server calls the rules of the core through the extension polyspec_hyper
// (HY-132.2), so a development checkout builds it from packages/php/native through the cargo of the link script and the
// PHP tests and the session workers load it from build/hyper-ext.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dryRun } from './make-dry-run.mts';
import { COMMANDS, HYPER_EXT } from './session-workers.mts';

test('hyper-ext builds packages/php/native through the cargo of the link script into build/hyper-ext (H35.25)', () => {
  const lines = dryRun('hyper-ext').join('\n');
  assert.match(lines, /link\.m[jt]s cargo \S+ build --locked -p polyspec-hyper-php-ext/u, lines);
  assert.match(lines, /publish\.mts directory build\/hyper-ext\.next-\S+ build\/hyper-ext$/mu, lines);
});

test('hyper-test-php builds the extension and loads it in both PHPUnit runs (H35.25)', () => {
  const lines = dryRun('hyper-test-php').join('\n');
  assert.match(lines, /polyspec-hyper-php-ext/u, lines);
  const runs = lines.split('\n').filter((line) => line.includes('phpunit --cwd'));
  assert.ok(runs.length > 0, lines);
  // The recipe names the absolute path of the library, as every extension that PHP loads (PHP_SERVER_EXTENSIONS).
  for (const run of runs) assert.match(run, new RegExp(`--php-extension /\\S*/${HYPER_EXT.replaceAll('.', '\\.')}( |$)`, 'u'), run);
});

test('hyper-install builds the extension after it writes the sources of the bindings (H35.25)', () => {
  const steps = dryRun('hyper-install')
    .map((line) => /--no-print-directory (\S+)/u.exec(line)?.[1])
    .filter((step) => step !== undefined);
  assert.ok(steps.indexOf('bindings') < steps.indexOf('hyper-ext'), `bindings runs before hyper-ext: ${steps.join(' ')}`);
});

test('the PHP session worker loads the extension (H35.25)', () => {
  assert.ok(COMMANDS.php.prefix.some((word) => word.startsWith('-dextension=') && word.endsWith(HYPER_EXT)), COMMANDS.php.prefix.join(' '));
});
