// Tests the pins of the plain release files of config/release-files.json (HR-80, H35.11, docs/operations/dependencies.md):
// the tag of an entry is an exact version and the tag of the Cargo dependency line of its library, each URL is the asset
// of that tag, each sha256 has its form, the install target downloads through $(ONLINE), and each installed file has the
// pinned digest. The test makes no request.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { jsonObject, jsonString, parseJsonObject } from '../../scripts/json.mts';
import { dryRun } from './make-dry-run.mts';
import { requireBuilt } from './requires.mts';

const CONFIG = 'config/release-files.json';
const config = parseJsonObject(readFileSync(CONFIG, 'utf8'), CONFIG);
const releases = Object.entries(jsonObject(config.releases, `${CONFIG} releases`)).map(([library, value]) => {
  const release = jsonObject(value, `${CONFIG} ${library}`);
  const files = Object.entries(jsonObject(release.files, `${CONFIG} ${library} files`)).map(([path, entry]) => {
    const file = jsonObject(entry, `${CONFIG} ${library} ${path}`);
    return { path, url: jsonString(file.url, `${library} ${path} url`), sha256: jsonString(file.sha256, `${library} ${path} sha256`) };
  });
  return { library, repository: jsonString(release.repository, `${library} repository`), tag: jsonString(release.tag, `${library} tag`), files };
});
const cargo = readFileSync('packages/rust/Cargo.toml', 'utf8');

test('config/release-files.json pins at least one file', () => {
  assert.equal(config.schema, 1, `${CONFIG} schema`);
  assert.ok(releases.some(({ files }) => files.length > 0), `${CONFIG} pins no file`);
});

test('the tag of each entry is an exact version and the tag of the Cargo dependency line of its library', () => {
  for (const { library, repository, tag } of releases) {
    assert.match(tag, /^v\d+\.\d+\.\d+$/, `${library}: the tag is v and an exact version`);
    const line = cargo.split('\n').find((text) => text.startsWith(`polyspec-${library} = `));
    assert.ok(line !== undefined, `packages/rust/Cargo.toml has no dependency line of polyspec-${library}`);
    assert.ok(line.includes(`git = "${repository}.git"`) && line.includes(`tag = "${tag}"`), `packages/rust/Cargo.toml: polyspec-${library} is ${line}, not ${repository}.git at ${tag}`);
  }
});

test('each URL is the asset of the tag and each sha256 is 64 lowercase hexadecimal digits', () => {
  for (const { library, repository, tag, files } of releases) {
    for (const { path, url, sha256 } of files) {
      assert.equal(url, `${repository}/releases/download/${tag}/${basename(path)}`, `${library} ${path}`);
      assert.match(sha256, /^[0-9a-f]{64}$/, `${library} ${path} sha256`);
    }
  }
});

test('the install target downloads through $(ONLINE)', () => {
  const lines = dryRun('hyper-install-release-files');
  const line = lines.find((text) => text.includes('scripts/install-release-files.mts'));
  assert.ok(line !== undefined, `make -n hyper-install-release-files runs no scripts/install-release-files.mts: ${lines.join('\n')}`);
  assert.match(line, /^env -u npm_config_offline -u COMPOSER_DISABLE_NETWORK /, 'the recipe downloads through $(ONLINE)');
});

test('each installed file has the pinned sha256', () => {
  const installed = releases.flatMap(({ library, tag, files }) => files.map((file) => ({ ...file, target: join('var/release-files', library, tag, file.path) })));
  requireBuilt('hyper-install-release-files', ...installed.map(({ target }) => target));
  for (const { target, sha256 } of installed) {
    assert.equal(createHash('sha256').update(readFileSync(target)).digest('hex'), sha256, target);
  }
});

// H35.11: every pin of polyspec-http-form names v0.0.4, the release whose files config/release-files.json pins, and
// Cargo.lock holds one polyspec-binding-core, the binding of the hyper core (docs/operations/dependencies.md).
const HTTP_FORM_TAG = 'v0.0.4';
const trackedPins = ['packages/rust/Cargo.toml', 'Cargo.lock', 'config/release-files.json'].map((path) => ({ path, text: readFileSync(path, 'utf8') }));

test('no tracked manifest or lock names polyspec-http-form v0.0.3', () => {
  for (const { path, text } of trackedPins) {
    assert.ok(!/polyspec-http-form[^\n]*v0\.0\.3/.test(text) && !/http-form\/releases\/download\/v0\.0\.3\//.test(text) && !/http-form\.git\?tag=v0\.0\.3/.test(text), `${path} still names polyspec-http-form v0.0.3`);
  }
});

test(`every manifest pins polyspec-http-form ${HTTP_FORM_TAG}`, () => {
  const line = cargo.split('\n').find((text) => text.startsWith('polyspec-http-form = '));
  assert.ok(line !== undefined && line.includes(`tag = "${HTTP_FORM_TAG}"`), `packages/rust/Cargo.toml: polyspec-http-form is ${line}`);
  assert.ok(releases.some(({ library, tag }) => library === 'http-form' && tag === HTTP_FORM_TAG), `${CONFIG} does not pin http-form ${HTTP_FORM_TAG}`);
  assert.match(readFileSync('Cargo.lock', 'utf8'), /name = "polyspec-http-form"\nversion = "0\.0\.4"\n/, 'Cargo.lock does not pin polyspec-http-form 0.0.4');
});

test('Cargo.lock holds one polyspec-binding-core', () => {
  const count = readFileSync('Cargo.lock', 'utf8').split('\n').filter((text) => text === 'name = "polyspec-binding-core"').length;
  assert.equal(count, 1, `Cargo.lock holds ${count} polyspec-binding-core packages`);
});
