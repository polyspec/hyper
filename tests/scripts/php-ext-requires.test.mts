// Tests scripts/php-ext-requires.mts (H35.52): the template package must require the json release that json-ext installs,
// because PHP loads one json library; a mismatch fails naming both versions, and template-ext runs the check before PIE.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { jsonProblems } from '../../scripts/php-ext-requires.mts';
import { dryRun } from './make-dry-run.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts/php-ext-requires.mts');
// The shape of the packages.json of a template release.
const repository = (json: string, extension = '*') => ({
  packages: { 'polyspec/template': { 'v0.0.29': { name: 'polyspec/template', require: { php: '>=8.4', 'ext-polyspec_json': extension, 'polyspec/json': json } } } },
});

test('a template that requires the json version of json-ext passes', () => {
  assert.deepEqual(jsonProblems(repository('0.0.34'), 'polyspec/template', '0.0.29', '0.0.34'), []);
});

test('a template that requires another json version fails naming both versions', () => {
  assert.deepEqual(jsonProblems(repository('0.0.35'), 'polyspec/template', '0.0.29', '0.0.34'), ['polyspec/template 0.0.29 requires polyspec/json 0.0.35, and json-ext installs 0.0.34']);
  assert.deepEqual(jsonProblems(repository('0.0.34', '0.0.33'), 'polyspec/template', '0.0.29', '0.0.34'), ['polyspec/template 0.0.29 requires ext-polyspec_json 0.0.33, and json-ext installs 0.0.34']);
});

test('a missing version or a missing json requirement fails', () => {
  assert.deepEqual(jsonProblems(repository('0.0.34'), 'polyspec/template', '0.0.30', '0.0.34'), ['the Composer repository has no polyspec/template 0.0.30']);
  const none = { packages: { 'polyspec/template': { 'v0.0.29': { require: { php: '>=8.4' } } } } };
  assert.deepEqual(jsonProblems(none, 'polyspec/template', '0.0.29', '0.0.34'), ['polyspec/template 0.0.29 requires no polyspec/json, so its json version is not known']);
});

test('the command exits 1 for a mismatch, 0 for a match and 2 for a usage error', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-php-ext-requires-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'packages.json');
  writeFileSync(file, JSON.stringify(repository('0.0.35')));
  const failed = spawnSync(process.execPath, [SCRIPT, file, 'polyspec/template', '0.0.29', '0.0.34'], { encoding: 'utf8' });
  assert.equal(failed.status, 1, failed.stderr);
  assert.match(failed.stderr, /requires polyspec\/json 0\.0\.35, and json-ext installs 0\.0\.34/);
  writeFileSync(file, JSON.stringify(repository('0.0.34')));
  assert.equal(spawnSync(process.execPath, [SCRIPT, file, 'polyspec/template', '0.0.29', '0.0.34'], { encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8' }).status, 2);
});

test('template-ext checks the json version of the template release before its PIE commands', () => {
  const lines = dryRun('template-ext');
  const work = `${ROOT}/var/pie/polyspec/template`;
  const check = lines.findIndex((line) => /scripts\/php-ext-requires\.mts https:\/\/github\.com\/polyspec\/template\/releases\/download\/v\S+\/packages\.json polyspec\/template \S+ \S+ && \\$/.test(line));
  const pie = lines.findIndex((line) => /\/mise\/shims\/pie /.test(line) && line.includes(`PIE_WORKING_DIRECTORY=${work} `));
  assert.ok(check >= 0 && pie > check, lines.join('\n'));
});
