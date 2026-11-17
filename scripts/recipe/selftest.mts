// The readers' mutation cases (HYR-8): each mutation of tests/scripts/fixtures/recipe/mutations.json is applied to a copy
// of the fixture, and the check must print the finding code that the mutation names. A run stops when one passes.

import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyMutation, isMutation, track } from './mutations.mts';
import type { Results } from './results.mts';
import { runChecks, type Validators } from './run.mts';
import { RUNNERS } from './types.mts';

/** The result files of a copy of the fixture, where the fixture keeps them. */
function fixtureResults(root: string): Results {
  const out: Results = {};
  for (const runner of RUNNERS) out[runner] = path.join(root, 'results', `${runner}.txt`);
  return out;
}

/**
 * Runs every mutation of the fixture; returns one line per mutation the check does not catch (empty when all are caught).
 * Each mutation starts the three readers on a copy of the fixture, so `progress`, when given, receives one line before
 * each mutation: the run prints what it does while it runs (HR-89).
 */
export function selfTest(fixture: string, v: Validators, progress?: (line: string) => void): string[] {
  const doc: unknown = JSON.parse(readFileSync(path.join(fixture, 'mutations.json'), 'utf8'));
  if (!Array.isArray(doc)) return ['MUTATIONS_INVALID mutations.json is not a list'];
  const entries: unknown[] = doc;
  const mutations = entries.filter(isMutation);
  if (mutations.length !== entries.length) return ['MUTATIONS_INVALID mutations.json has an entry without id, file or code'];
  const failures: string[] = [];
  for (const [index, m] of mutations.entries()) {
    progress?.(`recipe-check: mutation ${index + 1} of ${mutations.length}: ${m.id}`);
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
