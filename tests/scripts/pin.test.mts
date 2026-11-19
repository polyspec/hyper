// Tests make pin and make pin-check (HR-70, HR-80, HR-89, H35.75, H35.76). config/pins.json declares the release of
// each sibling polyspec package. pin-check reads every tracked file that names one, offline, and fails at each place
// that names another version with its file and line. pin writes the places that no tool writes from the declared
// versions and names the lock targets that write the rest; a wheel takes its sha256 from the field digest of its
// release asset. The fixture tree of fixtures/pin/tree holds one place of every kind, and fixtures/pin/releases the
// recorded release responses, so the tests run offline.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { track } from '../../scripts/recipe/mutations.mts';
import { lockFiles, lockGroups, pinFiles, type ReleaseOf } from '../../scripts/pin.mts';
import { dryRun } from './make-dry-run.mts';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, '..', '..', 'scripts', 'pin.mts');
const fixture = path.join(here, 'fixtures', 'pin');

/** Runs `run` with a tracked copy of the fixture tree and removes the copy. */
function withTree(run: (root: string) => void): void {
  const root = mkdtempSync(path.join(tmpdir(), 'pin-'));
  try {
    cpSync(path.join(fixture, 'tree'), root, { recursive: true });
    track(root);
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const read = (root: string, file: string): string => readFileSync(path.join(root, file), 'utf8');
const check = (root: string) => spawnSync(process.execPath, [script, 'check', '--root', root], { encoding: 'utf8' });

/** The recorded response of the release `version` of `repository`, or nothing for a release that is not recorded. */
const release: ReleaseOf = (repository, version) => {
  try {
    return JSON.parse(readFileSync(path.join(fixture, 'releases', `${repository.replace('/', '-')}-v${version}.json`), 'utf8'));
  } catch {
    return undefined;
  }
};

test('pin-check passes a tree whose every place names the declared version', () => {
  withTree((root) => {
    const result = check(root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /pin-check: (\d+) places/);
    const places = Number(/pin-check: (\d+) places/.exec(result.stdout)?.[1]);
    // Every place of the fixture: 4 release URLs of package.json, 1 plain version, 2 + 2 Cargo tags, 1 lock source,
    // 1 Composer repository, 2 platform versions, 1 Makefile variable, 1 php-ext pin, 1 wheel and 1 Go module.
    assert.equal(places, 17, result.stdout);
  });
});

// Each place of every kind, changed to another version, fails the check with its file, its line and its package.
const mutations: [string, string, string, number, string][] = [
  ['package.json', 'download/v0.0.38/polyspec-json-0.0.38.tgz', 'download/v0.0.39/polyspec-json-0.0.39.tgz', 9, 'json'],
  ['package.json', 'polyspec-json-darwin-arm64-0.0.38', 'polyspec-json-darwin-arm64-0.0.39', 13, 'json'],
  ['package.json', 'v0.0.6/polyspec-php-serialize-0.0.6', 'v0.0.5/polyspec-php-serialize-0.0.5', 10, 'php-serialize'],
  ['packages/ts/package.json', '"@polyspec/session-store": "0.0.7"', '"@polyspec/session-store": "0.0.6"', 6, 'session-store'],
  ['packages/rust/Cargo.toml', 'json.git", tag = "v0.0.38"', 'json.git", tag = "v0.0.39"', 8, 'json'],
  ['packages/ts/native/Cargo.toml', 'tag = "v0.0.21"', 'tag = "v0.0.20"', 7, 'binding'],
  ['Cargo.lock', '?tag=v0.0.38#', '?tag=v0.0.39#', 6, 'json'],
  ['composer.json', 'download/v0.0.38/packages.json', 'download/v0.0.39/packages.json', 6, 'json'],
  ['composer.json', '"ext-polyspec_json": "0.0.38"', '"ext-polyspec_json": "0.0.39"', 12, 'json'],
  ['Makefile', 'JSON_VERSION := 0.0.38', 'JSON_VERSION := 0.0.39', 1, 'json'],
  ['config/php-ext-pins.json', '"version": "0.0.38"', '"version": "0.0.39"', 5, 'json'],
  ['packages/python/pyproject.toml', 'polyspec_json-0.0.38-', 'polyspec_json-0.0.39-', 5, 'json'],
  ['packages/go/go.mod', 'packages/go v0.0.38', 'packages/go v0.0.39', 5, 'json'],
];
for (const [file, from, to, line, key] of mutations) {
  test(`pin-check fails for ${key} changed in ${file} at line ${line}`, () => {
    withTree((root) => {
      const text = read(root, file);
      assert.ok(text.includes(from), `${file} lacks ${from}`);
      writeFileSync(path.join(root, file), text.replace(from, to));
      const result = check(root);
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, new RegExp(`^${file.replace(/[.]/g, '\\.')}:${line}: ${key} `, 'm'), result.stderr);
    });
  });
}

test('pin writes every place that no tool writes and names the lock targets that write the others', () => {
  withTree((root) => {
    const before = read(root, 'Cargo.lock');
    const { written, targets } = pinFiles(root, { json: '0.0.40' }, release);
    assert.deepEqual(written.sort(), ['Makefile', 'composer.json', 'config/php-ext-pins.json', 'config/pins.json', 'package.json', 'packages/go/go.mod', 'packages/python/pyproject.toml', 'packages/rust/Cargo.toml', 'packages/ts/native/Cargo.toml']);
    assert.ok(read(root, 'package.json').includes('download/v0.0.40/polyspec-json-0.0.40.tgz'));
    assert.ok(read(root, 'package.json').includes('download/v0.0.40/polyspec-json-darwin-arm64-0.0.40.tgz'));
    assert.ok(read(root, 'package.json').includes('download/v0.0.6/polyspec-php-serialize-0.0.6.tgz'), 'another package keeps its version');
    assert.ok(read(root, 'packages/rust/Cargo.toml').includes('json.git", tag = "v0.0.40"'));
    assert.ok(read(root, 'composer.json').includes('download/v0.0.40/packages.json'));
    assert.ok(read(root, 'composer.json').includes('"ext-polyspec_json": "0.0.40"'));
    assert.ok(read(root, 'Makefile').startsWith('JSON_VERSION := 0.0.40\n'));
    assert.ok(read(root, 'config/php-ext-pins.json').includes('"version": "0.0.40"'));
    assert.ok(read(root, 'packages/python/pyproject.toml').includes('polyspec_json-0.0.40-cp314-abi3-macosx_11_0_arm64.whl#sha256=9336f7aed9e79a9febb215d5d2cb57a703073aa854cb965fb513f0f5090502f8'));
    assert.ok(read(root, 'config/pins.json').includes('"json": { "repository": "polyspec/json", "version": "0.0.40" }'));
    // The Cargo manifest of a binding and go.mod name the new release too, so that no lock target sees two versions of
    // one crate (H35.75-1); the locks and go.sum are written by their tools, which the targets name.
    assert.ok(read(root, 'packages/ts/native/Cargo.toml').includes('json.git", tag = "v0.0.40"'));
    assert.ok(read(root, 'packages/go/go.mod').includes('github.com/polyspec/json/packages/go v0.0.40'));
    assert.equal(read(root, 'Cargo.lock'), before);
    assert.deepEqual(targets, ['npm-lock', 'install-packages', 'cargo-lock CRATES=polyspec-json', 'bindings-scaffold', 'cargo-lock CRATES=polyspec-json', 'composer-lock PACKAGES=polyspec/json', 'php-ext-pins', 'python-lock']);
  });
});

test('a binding change runs cargo-lock again after bindings-scaffold, in a second make call', () => {
  withTree((root) => {
    const { targets } = pinFiles(root, { binding: '0.0.22' }, release);
    assert.ok(read(root, 'packages/ts/native/Cargo.toml').includes('binding.git", tag = "v0.0.22"'));
    assert.deepEqual(lockGroups(targets), [
      ['npm-lock', 'install-packages', 'cargo-lock CRATES=polyspec-binding-core', 'bindings-scaffold'],
      ['cargo-lock CRATES=polyspec-binding-core'],
    ]);
  });
});

test('a change of several crates names them in one cargo-lock, and every goal fits the two make calls of make pin', () => {
  withTree((root) => {
    const { targets } = pinFiles(root, { binding: '0.0.22', json: '0.0.40' }, release);
    const groups = lockGroups(targets);
    assert.equal(groups.length, 2, JSON.stringify(groups));
    assert.deepEqual(groups[0], ['npm-lock', 'install-packages', 'cargo-lock CRATES=polyspec-binding-core CRATES=polyspec-json', 'bindings-scaffold']);
    assert.deepEqual(groups[1], ['cargo-lock CRATES=polyspec-binding-core CRATES=polyspec-json', 'composer-lock PACKAGES=polyspec/json', 'php-ext-pins', 'python-lock']);
    assert.equal(lockFiles(groups[0] ?? []).crates, 'polyspec-binding-core polyspec-json\n');
  });
});

test('make pin-locks runs the goals of a group that pin wrote, in their order, with its crates and packages', () => {
  const locks = mkdtempSync(path.join(tmpdir(), 'pin-locks-'));
  try {
    const group = ['cargo-lock CRATES=polyspec-json', 'composer-lock PACKAGES=polyspec/json', 'php-ext-pins'];
    for (const [name, text] of Object.entries(lockFiles(group))) writeFileSync(path.join(locks, `locks-1.${name}`), text);
    const lines = dryRun('pin-locks', { variables: [`PIN_LOCKS=${path.join(locks, 'locks-1')}`] });
    const at = (pattern: RegExp): number => lines.findIndex((line) => pattern.test(line));
    const cargo = at(/cargo --tracked-lock .* update -p polyspec-json$/);
    const composer = at(/composer update --no-install --no-interaction polyspec\/json$/);
    const pins = at(/php-ext-pins\.mts write config\/php-ext-pins\.json$/);
    assert.ok(cargo >= 0 && composer > cargo && pins > composer, lines.join('\n'));
  } finally {
    rmSync(locks, { recursive: true, force: true });
  }
});

test('composer-lock names only the packages that the composer.lock beside a written composer.json locks (H35.75-2)', () => {
  withTree((root) => {
    // The fixture lock holds polyspec/json; session-store, whose extension PIE installs, is in no lock.
    const both = pinFiles(root, { json: '0.0.40', 'session-store': '0.0.8' }, release).targets.filter((t) => t.startsWith('composer-lock'));
    assert.deepEqual(both, ['composer-lock PACKAGES=polyspec/json']);
  });
});

test('pin names no composer-lock goal when no changed package is locked, since composer-lock refuses an empty PACKAGES (H35.75-2, H35.41)', () => {
  withTree((root) => {
    const { targets } = pinFiles(root, { 'session-store': '0.0.8' }, release);
    assert.deepEqual(targets.filter((t) => t.startsWith('composer-lock')), [], targets.join('\n'));
  });
});

test('pin with the declared versions writes nothing and names no target', () => {
  withTree((root) => {
    const result = pinFiles(root, { json: '0.0.38', binding: '0.0.21' }, release);
    assert.deepEqual(result, { written: [], targets: [] });
  });
});

test('pin of a wheel whose release gives no digest for its asset names the asset and writes nothing', () => {
  withTree((root) => {
    const before = read(root, 'package.json');
    assert.throws(() => pinFiles(root, { json: '0.0.41' }, release), /polyspec_json-0\.0\.41-cp314-abi3-macosx_11_0_arm64\.whl/);
    assert.equal(read(root, 'package.json'), before);
  });
});

test('pin refuses a package that config/pins.json does not declare', () => {
  withTree((root) => {
    assert.throws(() => pinFiles(root, { orm: '0.0.34' }, release), /orm/);
  });
});
