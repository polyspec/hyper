// The readers' mutation cases (HYR-8): each mutation of tests/scripts/fixtures/recipe/mutations.json is applied to a copy
// of the fixture, and the check must print the finding code that the mutation names. A run stops when one passes.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Results } from './results.mts';
import { runChecks, type Validators } from './run.mts';
import { LANGS } from './types.mts';

type Mutation = {
  id: string;
  file: string;
  code: string;
  from?: string;
  to?: string;
  rename?: string;
  create?: string;
  delete?: boolean;
};

function isMutation(x: unknown): x is Mutation {
  return typeof x === 'object' && x !== null && 'id' in x && 'file' in x && 'code' in x && typeof x.id === 'string' && typeof x.file === 'string' && typeof x.code === 'string';
}

/** Makes a copied tree a git repository whose files are all tracked: the readers list the files git tracks. */
function track(root: string): void {
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['add', '-A'], { cwd: root });
}

function applyMutation(root: string, m: Mutation): void {
  const file = path.join(root, m.file);
  if (m.delete === true) {
    unlinkSync(file);
    return;
  }
  if (m.create !== undefined) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, m.create);
    return;
  }
  const text = readFileSync(file, 'utf8');
  if (m.rename !== undefined) {
    unlinkSync(file);
    writeFileSync(path.join(root, m.rename), text);
    return;
  }
  const from = m.from ?? '';
  if (!text.includes(from)) throw new Error(`${JSON.stringify(from)} is not in ${m.file}`);
  writeFileSync(file, text.replace(from, m.to ?? ''));
}

/** The result files of a copy of the fixture, where the fixture keeps them. */
function fixtureResults(root: string): Results {
  const out: Results = {};
  for (const lang of LANGS) out[lang] = path.join(root, 'results', `${lang}.txt`);
  return out;
}

/** Runs every mutation of the fixture; returns one line per mutation the check does not catch (empty when all are caught). */
export function selfTest(fixture: string, v: Validators): string[] {
  const doc: unknown = JSON.parse(readFileSync(path.join(fixture, 'mutations.json'), 'utf8'));
  if (!Array.isArray(doc)) return ['MUTATIONS_INVALID mutations.json is not a list'];
  const mutations = doc.filter(isMutation);
  if (mutations.length !== doc.length) return ['MUTATIONS_INVALID mutations.json has an entry without id, file or code'];
  const failures: string[] = [];
  for (const m of mutations) {
    const root = mkdtempSync(path.join(tmpdir(), 'recipe-selftest-'));
    try {
      cpSync(fixture, root, { recursive: true });
      applyMutation(root, m);
      track(root);
      const findings = runChecks(root, v, fixtureResults(root), path.join(root, 'vendor', 'autoload.php'));
      if (!findings.some((f) => f.code === m.code)) failures.push(`MUTATION_PASSED ${m.id}: the check printed no ${m.code}`);
    } catch (error) {
      // A mutation the reader cannot read fails with READER_FAILED, which is its code when the code says so.
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes(m.code)) failures.push(`MUTATION_FAILED ${m.id}: ${message}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  return failures;
}
