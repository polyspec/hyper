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
