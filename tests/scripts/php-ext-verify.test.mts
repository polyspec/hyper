// Tests scripts/php-ext-verify.mts (HR-80, H35.51): it compares each platform zip of a PHP extension that Composer inside
// PIE downloaded into WORK/cache/files/<package>/<sha1 of the URL>.zip with the sha256 that config/php-ext-pins.json pins,
// fails for a changed byte, a zip of no pinned URL and a directory without a zip, and template-ext and json-ext give PIE
// that cache and run the script after `pie build`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cacheDirectory, cacheName, type Pin, verify, zipUrl } from '../../scripts/php-ext-verify.mts';
import { dryRun } from './make-dry-run.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts/php-ext-verify.mts');
const NAME = 'polyspec/json';
const CONTENT = Buffer.from('the bytes of a platform zip');
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const PIN: Pin = { repository: 'polyspec/json', version: '0.0.34', extension: 'polyspec_json', zips: { '8.4': { 'arm64-darwin-bsdlibc-nts': sha256(CONTENT) } } };
const URL = zipUrl(PIN, '8.4', 'arm64-darwin-bsdlibc-nts');

function work(t: TestContext): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-php-ext-verify-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// Writes `bytes` as the download of `url` into the Composer cache of `root`, as Composer names it.
function download(root: string, url: string, bytes: Buffer): string {
  const directory = cacheDirectory(root, NAME);
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, cacheName(url));
  writeFileSync(file, bytes);
  return file;
}

test('the cache name is the sha1 of the URL, as Composer names the download of the release asset', () => {
  // The run of json-ext on 2026-11-17 found this name for this URL in the Composer cache.
  assert.equal(cacheName('https://github.com/polyspec/json/releases/download/v0.0.34/php_polyspec_json-v0.0.34_php8.4-arm64-darwin-bsdlibc-nts.zip'), 'afee48fb19095183d463987b106f648c2a61538d.zip');
});

test('a zip whose sha256 is the pinned one passes', (t) => {
  const root = work(t);
  download(root, URL, CONTENT);
  assert.deepEqual(verify(NAME, PIN, root), []);
});

test('a zip with one changed byte fails with the file, the actual and the expected sha256', (t) => {
  const root = work(t);
  const changed = Buffer.from(CONTENT);
  changed[0] = (changed[0] ?? 0) ^ 1;
  const file = download(root, URL, changed);
  assert.deepEqual(verify(NAME, PIN, root), [`${file} (${URL}): sha256 ${sha256(changed)}, expected ${sha256(CONTENT)}`]);
});

test('a zip of no pinned URL fails', (t) => {
  const root = work(t);
  const file = download(root, zipUrl(PIN, '8.5', 'arm64-darwin-bsdlibc-nts'), CONTENT);
  assert.deepEqual(verify(NAME, PIN, root), [`${file}: the download of no pinned zip of ${NAME} 0.0.34`]);
});

test('a working directory without a zip of the package fails, because nothing was verified (HR-84)', (t) => {
  const root = work(t);
  const problems = verify(NAME, PIN, root);
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? '', /^no zip under .*cache\/files\/polyspec\/json; PIE downloaded none/);
});

test('the command exits 1 naming the file and both digests, 0 for a match and 2 for a usage error', (t) => {
  const root = work(t);
  const pins = path.join(root, 'pins.json');
  writeFileSync(pins, JSON.stringify({ packages: { [NAME]: PIN } }));
  const file = download(root, URL, Buffer.from('other bytes'));
  const failed = spawnSync(process.execPath, [SCRIPT, pins, NAME, root], { encoding: 'utf8' });
  assert.equal(failed.status, 1, failed.stderr);
  assert.ok(failed.stderr.includes(file) && failed.stderr.includes(sha256(CONTENT)) && failed.stderr.includes(sha256(Buffer.from('other bytes'))), failed.stderr);
  writeFileSync(file, CONTENT);
  const passed = spawnSync(process.execPath, [SCRIPT, pins, NAME, root], { encoding: 'utf8' });
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /1 zip of polyspec\/json under .* match config\/php-ext-pins\.json/);
  assert.equal(spawnSync(process.execPath, [SCRIPT, pins], { encoding: 'utf8' }).status, 2);
});

test('template-ext and json-ext give PIE a cache in its working directory and verify it after pie build', () => {
  // template-ext adds two Composer repositories, those of the template and of the json release (H35.52), and builds.
  for (const [target, name, output, commands] of [['template-ext', 'polyspec/template', 'build/ext', 3], ['json-ext', 'polyspec/json', 'build/json-ext', 2]] as const) {
    // The dry run of template-ext holds json-ext first, its prerequisite (H35.52), so the lines are those of `work`.
    const lines = dryRun(target);
    const work = `${ROOT}/var/pie/${name}`;
    const pie = lines.filter((line) => /\/mise\/shims\/pie /.test(line) && line.includes(`PIE_WORKING_DIRECTORY=${work} `));
    assert.equal(pie.length, commands, lines.join('\n'));
    for (const line of pie) assert.ok(line.includes(` COMPOSER_CACHE_DIR=${work}/cache `), line);
    const build = lines.findIndex((line) => line.includes(` build ${name}:`) && / --no-interaction && \\$/.test(line));
    const check = lines.findIndex((line) => line.includes(`scripts/php-ext-verify.mts config/php-ext-pins.json ${name} ${work}`));
    assert.ok(build >= 0 && check > build, `${target}: the verification follows pie build\n${lines.join('\n')}`);
    const publish = lines.findIndex((line) => line.includes(`scripts/publish.mts directory ${output}.next-`));
    assert.ok(publish > check, `${target}: the verification comes before the library is published\n${lines.join('\n')}`);
  }
});
