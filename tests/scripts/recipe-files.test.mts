// The check of the files of contracts/interfaces.json that needs no binding (H35.94, HYR-8): the schema, and for each
// unit and language the file and the class, interface or trait of the unit. It runs on a copy of the recipe fixture.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const fixture = path.join(here, 'fixtures', 'recipe');
const files = path.join(repo, 'scripts', 'recipe', 'files.mts');

/** Runs the check on a copy of the fixture that `change` edits, and removes the copy after it. */
function run(change: (root: string) => void): { status: number | null; stdout: string; stderr: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'hyper-recipe-files-'));
  try {
    cpSync(fixture, root, { recursive: true });
    change(root);
    return spawnSync(process.execPath, [files, '--root', root], { encoding: 'utf8' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Replaces `from` with `to` in the file `name` of `root`, and fails when the file does not hold `from`. */
function replace(root: string, name: string, from: string, to: string): void {
  const file = path.join(root, name);
  const text = readFileSync(file, 'utf8');
  assert.ok(text.includes(from), `${name} holds no ${from}`);
  writeFileSync(file, text.replace(from, to));
}

test('the fixture passes the check of the files and the check states its progress on the standard error', () => {
  const result = run(() => {});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /^recipe-files: /mu);
  assert.match(result.stdout, /^recipe-files: \d+ units name files and classes that exist$/mu);
});

test('a unit that names a file that does not exist fails and names the unit, the language and the file', () => {
  const result = run((root) =>
    replace(root, 'contracts/interfaces.json', '"packages/php/src/Session/Csrf.php"', '"packages/php/src/Session/Gone.php"'),
  );
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^UNIT_FILE_MISSING unit csrf names php packages\/php\/src\/Session\/Gone\.php, which does not exist$/mu);
});

test('a unit whose file declares no class of its name fails and names the unit, the language and the file', () => {
  const result = run((root) => replace(root, 'packages/php/src/Session/Csrf.php', 'class Csrf', 'class Other'));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^UNIT_CLASS_MISSING unit csrf names php packages\/php\/src\/Session\/Csrf\.php, which declares no class, interface or trait Csrf$/mu);
});

test('a file that the schema refuses fails before the files are read', () => {
  const result = run((root) => replace(root, 'contracts/interfaces.json', '"concerns"', '"concerns_"'));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^SPEC_INVALID /mu);
});

/**
 * Adds to the copy the extension unit `value-error` (HYR-5), whose native entry is `entry` and whose members are
 * `members`, and gives the member csrf.mask the errors `errors`.
 */
function extension(root: string, entry: string, members: string, errors: string): void {
  replace(
    root,
    'contracts/interfaces.json',
    '"units": [\n        {\n          "id": "csrf",',
    `"units": [\n        { "id": "value-error", "native": { "php": ${entry} }, "members": ${members} },\n        {\n          "id": "csrf",`,
  );
  replace(root, 'contracts/interfaces.json', '"errors": [],', `"errors": ${errors},`);
}

const entry = '{ "extension": "Polyspec\\\\Hyper\\\\ValueError", "kind": "class", "internal": true }';

test('an extension unit with no file and an error of its kind pass (HYR-5)', () => {
  const result = run((root) => extension(root, entry, '[]', '["value-error:token"]'));
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('an extension entry that also names a file fails the schema (HYR-5)', () => {
  const both = '{ "extension": "ValueError", "file": "packages/php/src/Session/Csrf.php", "kind": "class", "internal": true }';
  const result = run((root) => extension(root, both, '[]', '[]'));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^SPEC_INVALID /mu);
});

test('an extension unit with members fails and names the unit (HYR-5)', () => {
  const members = JSON.stringify([
    { id: 'value-error.kind', kind: 'method', visibility: 'internal', inputs: [], output: 'string', errors: [], state: 'Returns the kind.', native: { php: { symbol: 'x::ValueError::kind', signature: 'public function kind(): string' } } },
  ]);
  const result = run((root) => extension(root, entry, members, '[]'));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^EXTENSION_MEMBERS unit value-error is an extension class and lists 1 members$/mu);
});

test('an error kind of a unit that is no extension unit fails and names the member (HYR-5)', () => {
  const result = run((root) => extension(root, entry, '[]', '["csrf:token"]'));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^ERROR_UNIT_UNKNOWN csrf\.mask error csrf:token names csrf, which is no extension unit$/mu);
});

test('an error kind that no statement names fails and names the member (HYR-5)', () => {
  const result = run((root) => extension(root, entry, '[]', '["value-error:no_such_kind"]'));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^ERROR_KIND_UNKNOWN csrf\.mask error value-error:no_such_kind names a kind that no statement of protocol\.json names$/mu);
});
