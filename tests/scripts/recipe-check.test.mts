// The recipe check (HYR-8) over the fixture tree of fixtures/recipe: the fixture passes with its mutation cases, and each
// mutation of fixtures/recipe/mutations.json fails the check with the finding code that the mutation names.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const fixture = path.join(here, 'fixtures', 'recipe');
const check = path.join(repo, 'scripts', 'recipe', 'check.mts');

type Mutation = { id: string; file: string; code: string; from?: string; to?: string; rename?: string; create?: string; delete?: boolean };

const mutations = JSON.parse(readFileSync(path.join(fixture, 'mutations.json'), 'utf8')) as Mutation[];

function resultArguments(root: string): string[] {
  return ['php', 'node', 'python'].flatMap((lang) => ['--results', `${lang}=${path.join(root, 'results', `${lang}.txt`)}`]);
}

function applyMutation(root: string, m: Mutation): void {
  const file = path.join(root, m.file);
  if (m.delete) {
    unlinkSync(file);
    return;
  }
  if (m.create !== undefined) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, m.create);
    return;
  }
  if (m.rename !== undefined) {
    const text = readFileSync(file, 'utf8');
    unlinkSync(file);
    writeFileSync(path.join(root, m.rename), text);
    return;
  }
  const text = readFileSync(file, 'utf8');
  const from = m.from ?? '';
  assert.ok(text.includes(from), `mutation ${m.id}: ${JSON.stringify(from)} is not in ${m.file}`);
  writeFileSync(file, text.replace(from, m.to ?? ''));
}

test('the fixture passes the recipe check, with its mutation cases first', () => {
  const result = spawnSync(process.execPath, [check, '--root', fixture, ...resultArguments(fixture)], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

for (const m of mutations) {
  test(`mutation ${m.id} fails with ${m.code}`, () => {
    const root = mkdtempSync(path.join(tmpdir(), 'recipe-mutation-'));
    try {
      cpSync(fixture, root, { recursive: true });
      applyMutation(root, m);
      const result = spawnSync(process.execPath, [check, '--root', root, '--no-selftest', ...resultArguments(root)], { encoding: 'utf8' });
      assert.notEqual(result.status, 0, `mutation ${m.id} passed the check`);
      assert.match(result.stdout + result.stderr, new RegExp(`\\b${m.code}\\b`));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
