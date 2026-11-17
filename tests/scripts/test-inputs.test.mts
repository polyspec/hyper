// Tests scripts/test-inputs.mts and the prerequisites of `make hyper-test-scripts` (HR-85, H35.55): a selection of TESTS
// builds only the inputs that its files and the modules that they import name with requireBuilt, and the full set builds
// every input.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inputs } from '../../scripts/test-inputs.mts';
import { dryRun } from './make-dry-run.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('the targets of requireBuilt and phpServerExtensions are collected through relative imports', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-test-inputs-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(path.join(directory, 'helper.mts'), "export const start = () => { requireBuilt('node-server', 'x'); };\n");
  writeFileSync(path.join(directory, 'a.test.mts'), "import { start } from './helper.mts';\nrequireBuilt('packages board', 'y');\nconst e = phpServerExtensions();\n");
  writeFileSync(path.join(directory, 'none.test.mts'), "import { dryRun } from './other.mts';\n");
  writeFileSync(path.join(directory, 'other.mts'), 'export const dryRun = 1;\n');
  assert.deepEqual([...inputs([path.join(directory, 'a.test.mts')])].sort(), ['board', 'ext', 'hyper-ext', 'node-server', 'packages']);
  assert.deepEqual([...inputs([path.join(directory, 'none.test.mts')])], []);
  assert.throws(() => inputs([path.join(directory, 'missing.test.mts')]), /no such file/);
});

test('a selection of hyper-test-scripts that reads no built input starts no build and no cargo (H35.55)', () => {
  const lines = dryRun('hyper-test-scripts', { variables: ['TESTS=tests/scripts/php-ext-requires.test.mts'] });
  assert.deepEqual(lines.filter((line) => /\bcargo\b/.test(line)), [], lines.join('\n'));
  assert.ok(lines.some((line) => line.includes('tests/scripts/php-ext-requires.test.mts')), lines.join('\n'));
});

test('a selection of upload-servers builds the Node addon that its application loads (HR-85, H34.4)', () => {
  const lines = dryRun('hyper-test-scripts', { variables: ['TESTS=tests/scripts/upload-servers.test.mts'] });
  assert.ok(lines.some((line) => /\bcargo\b.* build --locked --offline -p polyspec-hyper-node\b/.test(line)), `make -n hyper-test-scripts TESTS=tests/scripts/upload-servers.test.mts builds no Node addon:\n${lines.join('\n')}`);
});

test('a selection builds the inputs that its files name, and the full set builds every input', () => {
  assert.deepEqual([...inputs([path.join(ROOT, 'tests/scripts/session-shared.test.mts')])].filter((target) => ['packages', 'board', 'node-server', 'ext', 'hyper-ext'].includes(target)).sort(), ['hyper-ext', 'packages']);
  // make exports the TESTS of the make that runs this file to the environment of its recipe, so the full set clears it.
  assert.ok(dryRun('hyper-test-scripts', { variables: ['TESTS='] }).some((line) => /\bcargo\b/.test(line)));
});
