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
import { jsonObject, jsonObjects } from '../../scripts/json.mts';
import { pinsText, recordedFiles } from '../../scripts/php-ext-pins.mts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, '..', '..');
const PINS = path.join(repository, 'config', 'php-ext-pins.json');
// The recorded response of releases/tags/v<version> of `repo`, as the fixture file <name>-v<version>.json holds it.
const recorded = (repo: string, version: string): unknown =>
  JSON.parse(readFileSync(path.join(here, 'fixtures', 'php-ext-pins', `${repo.split('/')[1] ?? repo}-v${version}.json`), 'utf8'));

test('make php-ext-pins writes the pins with the script under $(ONLINE) (HR-89, H35.58)', () => {
  const lines = dryRun('php-ext-pins');
  const line = lines.find((text) => text.endsWith('/scripts/php-ext-pins.mts write config/php-ext-pins.json'));
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
    const release = jsonObject(recorded(repo, version), `the release ${repo} v${version}`);
    const assets = jsonObjects(release.assets, `the assets of ${repo} v${version}`);
    return { ...release, assets: assets.map((asset) => (asset.name === 'packages.json' ? { ...asset, digest: null } : asset)) };
  };
  assert.throws(() => pinsText(committed, withoutDigest), /packages\.json.*no sha256 digest/u);
});

// The recorder (H35.74-1): make php-ext-pins-record writes, for each pinned package, the body of the response of its
// release as the fixture that the tests above read; the tests give it the bodies, so no test reads the network.
const PINNED = `${JSON.stringify({ packages: { 'polyspec/json': { repository: 'polyspec/json', version: '0.0.40', packages: '', extension: 'polyspec_json', zips: {} } } }, null, 2)}\n`;
const BODY = '{"tag_name":"v0.0.40","assets":[{"name":"packages.json","digest":"sha256:00"}]}';

test('the recorder names the fixture of each pinned release after its repository and version and keeps the body as it came (H35.74-1)', () => {
  const asked: string[] = [];
  const files = recordedFiles(PINNED, (repository, version) => {
    asked.push(`${repository} ${version}`);
    return BODY;
  });
  assert.deepEqual(asked, ['polyspec/json 0.0.40']);
  assert.deepEqual(files, { 'json-v0.0.40.json': BODY });
});

test('the recorder refuses a body that is no release with assets, before it writes (H35.74-1)', () => {
  assert.throws(() => recordedFiles(PINNED, () => '{"message":"Not Found"}'), /polyspec\/json v0\.0\.40.*no release with assets/u);
});

test('make php-ext-pins-record records the fixtures with the script under $(ONLINE) (HR-89, H35.74-1)', () => {
  const lines = dryRun('php-ext-pins-record');
  const line = lines.find((text) => text.endsWith('/scripts/php-ext-pins.mts record config/php-ext-pins.json tests/scripts/fixtures/php-ext-pins'));
  assert.ok(line !== undefined, `make -n php-ext-pins-record runs no scripts/php-ext-pins.mts record:\n${lines.join('\n')}`);
  assert.match(line, /^env -u npm_config_offline -u COMPOSER_DISABLE_NETWORK /u, 'the recorder reads the releases API without $(ONLINE)');
});
