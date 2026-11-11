// The recipe check (HYR-8) over the fixture tree of fixtures/recipe: the fixture passes with its mutation cases, and each
// mutation of fixtures/recipe/mutations.json fails the check with the finding code that the mutation names.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { validators } from '../../scripts/recipe/validators.mts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const fixture = path.join(here, 'fixtures', 'recipe');
const check = path.join(repo, 'scripts', 'recipe', 'check.mts');
const candidate = path.join(repo, 'scripts', 'recipe', 'candidate.mts');
/** The PHP autoloader of a recipe tree: the fixture's stand-in for the server's Composer autoloader. */
const phpAutoload = (root: string): string => path.join(root, 'vendor', 'autoload.php');

type Mutation = { id: string; file: string; code: string; from?: string; to?: string; rename?: string; create?: string; delete?: boolean };

test('the schema term is the vocabulary: a status number is not a term', () => {
  const text = readFileSync(path.join(fixture, 'contracts', 'interfaces.json'), 'utf8');
  const spec = validators().spec;
  assert.equal(spec(JSON.parse(text)), true);
  assert.equal(spec(JSON.parse(text.replace('"output": "string",', '"output": "404",'))), false);
});

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
  const result = spawnSync(process.execPath, [check, '--root', fixture, '--php-autoload', phpAutoload(fixture), ...resultArguments(fixture)], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('the candidate refreshes the native fields and lists the hand-written ones', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'recipe-candidate-'));
  try {
    const output = path.join(dir, 'interfaces.candidate.json');
    const result = spawnSync(process.execPath, [candidate, '--root', fixture, '--php-autoload', phpAutoload(fixture), '--output', output], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const spec = JSON.parse(readFileSync(output, 'utf8')) as { schema: number };
    assert.equal(spec.schema, 1);
    const handWritten = JSON.parse(readFileSync(path.join(dir, 'interfaces.candidate.hand-written.json'), 'utf8')) as string[];
    assert.ok(handWritten.includes('/concerns/0/rules'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the candidate derives the units and concerns from an empty skeleton', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'recipe-skeleton-'));
  const root = mkdtempSync(path.join(tmpdir(), 'recipe-skeleton-root-'));
  try {
    cpSync(fixture, root, { recursive: true });
    const spec = JSON.parse(readFileSync(path.join(fixture, 'contracts', 'interfaces.json'), 'utf8')) as Record<string, unknown>;
    writeFileSync(path.join(root, 'contracts', 'interfaces.json'), JSON.stringify({ ...spec, outside: [], concerns: [], types: [] }));
    const output = path.join(dir, 'interfaces.candidate.json');
    const result = spawnSync(process.execPath, [candidate, '--root', root, '--php-autoload', phpAutoload(root), '--output', output], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const derived = JSON.parse(readFileSync(output, 'utf8')) as { concerns: { id: string; units: { native: Record<string, unknown> }[] }[] };
    const csrf = derived.concerns.find((c) => c.id === 'csrf');
    assert.ok(csrf, 'no concern csrf');
    assert.deepEqual(Object.keys(csrf?.units[0]?.native ?? {}).sort(), ['node', 'php', 'python']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

for (const m of mutations) {
  test(`mutation ${m.id} fails with ${m.code}`, () => {
    const root = mkdtempSync(path.join(tmpdir(), 'recipe-mutation-'));
    try {
      cpSync(fixture, root, { recursive: true });
      applyMutation(root, m);
      const result = spawnSync(process.execPath, [check, '--root', root, '--php-autoload', phpAutoload(root), '--no-selftest', ...resultArguments(root)], { encoding: 'utf8' });
      assert.notEqual(result.status, 0, `mutation ${m.id} passed the check`);
      assert.match(result.stdout + result.stderr, new RegExp(`\\b${m.code}\\b`));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
