// Tests scripts/php-ext-requires.mts (H35.52, H35.54): the packages.json of each release is written into WORK and refused
// unless it has the sha256 that config/php-ext-pins.json pins, before anything reads it; the template package must require
// the json release that json-ext installs, because PHP loads one json library; and PIE adds the verified copy as its
// repository, not the URL.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fetchVerified, jsonProblems, packagesPath, packagesUrl, readPackagesPin } from '../../scripts/php-ext-requires.mts';
import { readPin } from '../../scripts/php-ext-verify.mts';
import { dryRun } from './make-dry-run.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts/php-ext-requires.mts');
const PINS = path.join(ROOT, 'config/php-ext-pins.json');
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

// A pin file whose package polyspec/template pins the sha256 of `bytes` as its packages.json.
function pinsFor(directory: string, bytes: Buffer): string {
  const file = path.join(directory, 'pins.json');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(file, JSON.stringify({ packages: { 'polyspec/template': { repository: 'polyspec/template', version: '0.0.29', extension: 'polyspec_template', packages: sha256, zips: {} } } }));
  return file;
}

test('a packages.json with the pinned sha256 is written into WORK and read (HR-80, H35.54)', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-php-ext-requires-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bytes = Buffer.from(JSON.stringify(repository('0.0.34')));
  const pins = pinsFor(directory, bytes);
  const urls: string[] = [];
  const read = await fetchVerified(pins, 'polyspec/template', directory, async (url) => (urls.push(url), bytes));
  assert.deepEqual(urls, ['https://github.com/polyspec/template/releases/download/v0.0.29/packages.json']);
  assert.deepEqual(read, repository('0.0.34'));
  assert.deepEqual(readFileSync(packagesPath(directory, 'polyspec/template')), bytes);
});

test('a packages.json with another sha256 is refused naming the file, the expected and the actual sha256 (HR-80, H35.54)', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-php-ext-requires-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const pins = pinsFor(directory, Buffer.from(JSON.stringify(repository('0.0.34'))));
  const changed = Buffer.from(JSON.stringify(repository('0.0.35')));
  const expected = readPackagesPin(pins, 'polyspec/template');
  const actual = createHash('sha256').update(changed).digest('hex');
  const file = packagesPath(directory, 'polyspec/template');
  await assert.rejects(fetchVerified(pins, 'polyspec/template', directory, async () => changed), (error: Error) => {
    assert.equal(error.message, `${file} (https://github.com/polyspec/template/releases/download/v0.0.29/packages.json): sha256 ${actual}, expected ${expected}`);
    return true;
  });
});

test('config/php-ext-pins.json pins the sha256 of the packages.json of the template and the json release', () => {
  for (const name of ['polyspec/template', 'polyspec/json']) {
    assert.match(readPackagesPin(PINS, name), /^[0-9a-f]{64}$/, name);
    assert.equal(packagesUrl(readPin(PINS, name)), `https://github.com/${name}/releases/download/v${readPin(PINS, name).version}/packages.json`);
  }
});

test('the command exits 2 for a usage error and 1 for a pin file without a packages.json pin', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-php-ext-requires-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.equal(spawnSync(process.execPath, [SCRIPT, PINS], { encoding: 'utf8' }).status, 2);
  const pins = path.join(directory, 'pins.json');
  writeFileSync(pins, JSON.stringify({ packages: { 'polyspec/template': { repository: 'polyspec/template', version: '0.0.29', extension: 'polyspec_template', zips: {} } } }));
  const failed = spawnSync(process.execPath, [SCRIPT, pins, 'polyspec/template', directory], { encoding: 'utf8' });
  assert.equal(failed.status, 1, failed.stderr);
  assert.match(failed.stderr, /polyspec\/template has no sha256 of its packages\.json/);
  assert.equal(existsSync(packagesPath(directory, 'polyspec/template')), false);
});

test('template-ext and json-ext verify each packages.json before PIE and give PIE the local copy as its repository (H35.54)', () => {
  for (const [target, name, work, repositories] of [
    ['template-ext', 'polyspec/template', `${ROOT}/var/pie/polyspec/template`, ['polyspec/template', 'polyspec/json']],
    ['json-ext', 'polyspec/json', `${ROOT}/var/pie/polyspec/json`, ['polyspec/json']],
  ] as const) {
    const lines = dryRun(target);
    const required = target === 'template-ext' ? ' polyspec/json' : '';
    const check = lines.findIndex((line) => line.includes(`scripts/php-ext-requires.mts config/php-ext-pins.json ${name} ${work}${required} && \\`));
    const added = lines.filter((line) => /\/mise\/shims\/pie repository:add /.test(line) && line.includes(`PIE_WORKING_DIRECTORY=${work} `));
    assert.deepEqual(added.map((line) => / repository:add composer (\S+) /.exec(line)?.[1]), repositories.map((repo) => packagesPath(work, repo)), lines.join('\n'));
    assert.ok(check >= 0 && check < lines.indexOf(added[0] ?? ''), lines.join('\n'));
  }
});
