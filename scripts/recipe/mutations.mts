// The mutations of a fixture tree of the recipe check (HYR-8): an entry of mutations.json names a file of the tree, the
// change of it and the finding code that the check must print for the changed tree. The self test of the check and the
// test of the check both read the entries and apply them with these functions.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * One mutation: the file, the finding code, and one change of the file: `delete`, `create` with its content, `rename`
 * to another path, or the replacement of the text `from` by `to`. `forbid` is a code that the check must not print and
 * `detail` a text that its output must hold.
 */
export type Mutation = {
  id: string;
  file: string;
  code: string;
  from?: string;
  to?: string;
  rename?: string;
  create?: string;
  delete?: boolean;
  forbid?: string;
  detail?: string;
};

/** True for an entry that names its id, its file and its code. */
export function isMutation(x: unknown): x is Mutation {
  return typeof x === 'object' && x !== null && 'id' in x && 'file' in x && 'code' in x && typeof x.id === 'string' && typeof x.file === 'string' && typeof x.code === 'string';
}

/** Reads the mutations of a file; a file that is no list, or an entry without id, file or code, fails. */
export function readMutations(file: string): Mutation[] {
  const doc: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(doc)) throw new Error(`${file} is not a list`);
  const entries: unknown[] = doc;
  const mutations = entries.filter(isMutation);
  if (mutations.length !== entries.length) throw new Error(`${file} has an entry without id, file or code`);
  return mutations;
}

/** Makes a copied tree a git repository whose files are all tracked: the readers list the files git tracks. */
export function track(root: string): void {
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['add', '-A'], { cwd: root });
}

/** Applies a mutation to the tree of `root`; a `from` text that the file does not hold fails. */
export function applyMutation(root: string, m: Mutation): void {
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
  if (!text.includes(from)) throw new Error(`mutation ${m.id}: ${JSON.stringify(from)} is not in ${m.file}`);
  writeFileSync(file, text.replace(from, m.to ?? ''));
}
