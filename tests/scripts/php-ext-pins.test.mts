// Tests the writer of config/php-ext-pins.json (HR-80, HR-89, H35.58): make php-ext-pins, an install target that runs
// under $(ONLINE), reads the asset list of the release of each pinned PHP extension package from the releases API and
// writes the sha256 of its packages.json and of each platform zip from the field digest of the asset. The writer only
// writes: the install that downloads an asset verifies it by that pin. The tests read the recorded API responses of
// fixtures/php-ext-pins and run offline.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dryRun } from './make-dry-run.mts';
import { pinsText } from '../../scripts/php-ext-pins.mts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, '..', '..');
const PINS = path.join(repository, 'config', 'php-ext-pins.json');
// The recorded response of releases/tags/v<version> of `repo`, as the fixture file <name>-v<version>.json holds it.
const recorded = (repo: string, version: string): unknown =>
  JSON.parse(readFileSync(path.join(here, 'fixtures', 'php-ext-pins', `${repo.split('/')[1] ?? repo}-v${version}.json`), 'utf8'));

test('make php-ext-pins writes the pins with the script under $(ONLINE) (HR-89, H35.58)', () => {
  const lines = dryRun('php-ext-pins');
  const line = lines.find((text) => /\/scripts\/php-ext-pins\.mts write config\/php-ext-pins\.json$/u.test(text));
  assert.ok(line !== undefined, `make -n php-ext-pins runs no scripts/php-ext-pins.mts write:\n${lines.join('\n')}`);
  assert.match(line, /^env -u npm_config_offline -u COMPOSER_DISABLE_NETWORK /u, 'the writer reads the releases API without $(ONLINE)');
});

test('the writer gives the bytes of the committed file from the recorded release responses (H35.58)', () => {
  const committed = readFileSync(PINS, 'utf8');
  assert.equal(pinsText(committed, recorded), committed);
});

test('the writer refuses an asset of a pinned file that has no digest (H35.58)', () => {
  const committed = readFileSync(PINS, 'utf8');
  const withoutDigest = (repo: string, version: string): unknown => {
    const release = recorded(repo, version) as { assets: { name: string; digest?: string | null }[] };
    return { ...release, assets: release.assets.map((asset) => (asset.name === 'packages.json' ? { ...asset, digest: null } : asset)) };
  };
  assert.throws(() => pinsText(committed, withoutDigest), /packages\.json.*no sha256 digest/u);
});
