// Tests the writer of config/php-ext-pins.json (HR-80, HR-89, H35.58): make php-ext-pins, an install target that runs
// under $(ONLINE), reads the assets of the release of each pinned PHP extension package and writes the sha256 of its
// packages.json and of each platform zip from the field digest of the asset, after the sha256 of each downloaded asset
// equals that digest; no sha256 of the file is copied by hand.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { dryRun } from './make-dry-run.mts';
import { downloadProblems, pinFromRelease, type ReleaseAsset } from '../../scripts/php-ext-pins.mts';

const sha256 = (bytes: string): string => createHash('sha256').update(bytes).digest('hex');
const asset = (name: string, bytes: string): ReleaseAsset => ({ name, digest: `sha256:${sha256(bytes)}`, url: `https://example.invalid/${name}` });

test('make php-ext-pins writes the pins with the script under $(ONLINE) (HR-89, H35.58)', () => {
  const lines = dryRun('php-ext-pins');
  const line = lines.find((text) => /\/scripts\/php-ext-pins\.mts write config\/php-ext-pins\.json /u.test(text));
  assert.ok(line !== undefined, `make -n php-ext-pins runs no scripts/php-ext-pins.mts write:\n${lines.join('\n')}`);
  assert.match(line, /^env -u npm_config_offline -u COMPOSER_DISABLE_NETWORK /u, 'the writer downloads without $(ONLINE)');
});

test('the pin of a package is the digest of its packages.json and of each platform zip of the release (H35.58)', () => {
  const assets = [
    asset('packages.json', 'repository'),
    asset('php_polyspec_x-v1.2.3_php8.4-arm64-darwin-bsdlibc-nts.zip', 'a'),
    asset('php_polyspec_x-v1.2.3_php8.5-x86_64-linux-glibc-nts.zip', 'b'),
    asset('polyspec-x-1.2.3.tgz', 'c'),
  ];
  const pin = pinFromRelease({ repository: 'polyspec/x', version: '1.2.3', extension: 'polyspec_x' }, assets);
  assert.deepEqual(pin, {
    repository: 'polyspec/x',
    version: '1.2.3',
    packages: sha256('repository'),
    extension: 'polyspec_x',
    zips: { '8.4': { 'arm64-darwin-bsdlibc-nts': sha256('a') }, '8.5': { 'x86_64-linux-glibc-nts': sha256('b') } },
  });
  assert.throws(() => pinFromRelease({ repository: 'polyspec/x', version: '1.2.3', extension: 'polyspec_x' }, assets.slice(1)), /packages\.json/u, 'a release without packages.json gives a pin');
});

test('a downloaded asset whose sha256 is not its digest fails the writer (H35.58)', () => {
  const good = asset('packages.json', 'repository');
  const bad = asset('php_polyspec_x-v1.2.3_php8.4-arm64-darwin-bsdlibc-nts.zip', 'a');
  assert.deepEqual(downloadProblems([good], new Map([[good.name, Buffer.from('repository')]])), []);
  const problems = downloadProblems([good, bad], new Map([[good.name, Buffer.from('repository')], [bad.name, Buffer.from('changed')]]));
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0] ?? '', new RegExp(`${bad.name}.*${sha256('a')}.*${sha256('changed')}`, 'u'));
});
