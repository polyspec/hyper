// Tests scripts/php-ext-verify.mts (HR-80, H35.51): it compares each platform zip of a PHP extension that PIE downloaded
// into its working directory with the sha256 that config/php-ext-pins.json pins, fails for a changed byte, an unpinned
// platform, another version and a directory without a zip, and template-ext and json-ext run it after `pie build`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { type Pin, verify, zipName } from '../../scripts/php-ext-verify.mts';
import { dryRun } from './make-dry-run.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts/php-ext-verify.mts');
const CONTENT = Buffer.from('the bytes of a platform zip');
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const PIN: Pin = { repository: 'polyspec/template', version: '0.0.29', extension: 'polyspec_template', zips: { '8.4': { 'arm64-darwin-bsdlibc-nts': sha256(CONTENT) } } };

function work(t: TestContext): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-php-ext-verify-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// Writes `bytes` as the zip `name` in a nested directory of `root`, as PIE keeps its downloads.
function download(root: string, name: string, bytes: Buffer): string {
  const directory = path.join(root, 'php_8.4-abc', 'downloads');
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, name);
  writeFileSync(file, bytes);
  return file;
}

test('a zip whose sha256 is the pinned one passes', (t) => {
  const root = work(t);
  download(root, zipName(PIN, '8.4', 'arm64-darwin-bsdlibc-nts'), CONTENT);
  assert.deepEqual(verify(PIN, root), []);
});

test('a zip with one changed byte fails with the file, the actual and the expected sha256', (t) => {
  const root = work(t);
  const changed = Buffer.from(CONTENT);
  changed[0] = (changed[0] ?? 0) ^ 1;
  const file = download(root, zipName(PIN, '8.4', 'arm64-darwin-bsdlibc-nts'), changed);
  assert.deepEqual(verify(PIN, root), [`${file}: sha256 ${sha256(changed)}, expected ${sha256(CONTENT)}`]);
});

test('a zip of an unpinned platform or another version fails', (t) => {
  const root = work(t);
  const platform = download(root, zipName(PIN, '8.5', 'arm64-darwin-bsdlibc-nts'), CONTENT);
  const version = download(root, `php_polyspec_template-v0.0.28_php8.4-arm64-darwin-bsdlibc-nts.zip`, CONTENT);
  assert.deepEqual(verify(PIN, root).sort(), [`${platform}: no pinned sha256 for PHP 8.5 on arm64-darwin-bsdlibc-nts`, `${version}: version 0.0.28, expected 0.0.29`].sort());
});

test('a working directory without a zip of the extension fails, because nothing was verified (HR-84)', (t) => {
  const root = work(t);
  assert.equal(verify(PIN, root).length, 1);
  assert.match(verify(PIN, root)[0] ?? '', /no zip php_polyspec_template-\*\.zip under /);
});

test('the command exits 1 naming the file and both digests, and 2 for a usage error', (t) => {
  const root = work(t);
  const pins = path.join(root, 'pins.json');
  writeFileSync(pins, JSON.stringify({ packages: { 'polyspec/template': PIN } }));
  const file = download(root, zipName(PIN, '8.4', 'arm64-darwin-bsdlibc-nts'), Buffer.from('other bytes'));
  const failed = spawnSync(process.execPath, [SCRIPT, pins, 'polyspec/template', root], { encoding: 'utf8' });
  assert.equal(failed.status, 1, failed.stderr);
  assert.ok(failed.stderr.includes(file) && failed.stderr.includes(sha256(CONTENT)) && failed.stderr.includes(sha256(Buffer.from('other bytes'))), failed.stderr);
  assert.equal(spawnSync(process.execPath, [SCRIPT, pins], { encoding: 'utf8' }).status, 2);
});

test('template-ext and json-ext verify the zips of their working directory after pie build', () => {
  for (const [target, name] of [['template-ext', 'polyspec/template'], ['json-ext', 'polyspec/json']] as const) {
    const lines = dryRun(target);
    const build = lines.findIndex((line) => / build polyspec\/(template|json):\S+ --no-interaction$/.test(line));
    const check = lines.findIndex((line) => line.includes(`scripts/php-ext-verify.mts config/php-ext-pins.json ${name} ${ROOT}/var/pie/${name}`));
    assert.ok(build >= 0 && check > build, `${target}: the verification follows pie build\n${lines.join('\n')}`);
    const publish = lines.findIndex((line) => line.includes('scripts/publish.mts'));
    assert.ok(publish > check, `${target}: the verification comes before the library is published\n${lines.join('\n')}`);
  }
});
