// The results of the case runners (HYR-7): each runner writes `CASE <file> <id> PASS|FAIL <reason>` per case to the
// results file that the check is given, and the check takes success from these lines and from the exit status alone.

import { existsSync, readFileSync } from 'node:fs';
import { RUNNERS, isObject, type Finding, type Runner, type Spec } from './types.mts';
import type { CaseFile } from './types.mts';
import { caseFilePath } from './legacy.mts';

export type Results = Partial<Record<Runner, string>>;

type CaseId = { file: string; id: string; runners: Runner[] };

const LINE = /^CASE (\S+) (\S+) (PASS|FAIL)(?: (.*))?$/;

/** The runners a case names in its `only`; a case without `only` counts for all of them. */
function onlyRunners(only: unknown): Runner[] {
  if (typeof only !== 'object' || only === null || !('languages' in only) || !Array.isArray(only.languages)) return RUNNERS;
  const named: unknown[] = only.languages;
  return RUNNERS.filter((r) => named.includes(r));
}

/** The case ids of a case file: the items of each section, for the runners the section names and the item's `only` keeps. */
function caseIds(file: string, entry: CaseFile | undefined, data: unknown): CaseId[] {
  if (entry === undefined || !isObject(data)) return [];
  const out: CaseId[] = [];
  for (const [name, section] of Object.entries(entry.sections)) {
    const items = data[name];
    if (!Array.isArray(items)) continue;
    const list: unknown[] = items;
    for (const item of list) {
      if (!isObject(item) || typeof item.id !== 'string') continue;
      const kept = onlyRunners(item.only);
      out.push({ file, id: item.id, runners: section.runners.filter((r) => kept.includes(r)) });
    }
  }
  return out;
}

/** Checks the result lines of each runner against the cases of the spec; a case without a line fails. */
export function checkResults(root: string, spec: Spec, results: Results): Finding[] {
  const out: Finding[] = [];
  const cases: CaseId[] = [];
  for (const [name, entry] of Object.entries(spec.caseFiles)) {
    const full = caseFilePath(root, name);
    if (existsSync(full)) cases.push(...caseIds(name, entry, JSON.parse(readFileSync(full, 'utf8'))));
  }
  const key = (file: string, id: string): string => `${file}\t${id}`;

  for (const runner of RUNNERS) {
    const expected = cases.filter((c) => c.runners.includes(runner));
    const expectedKeys = new Set(expected.map((c) => key(c.file, c.id)));
    const file = results[runner];
    if (file === undefined || !existsSync(file)) {
      for (const c of expected) out.push({ code: 'RESULT_MISSING', message: `${runner} prints no line for ${c.file} ${c.id}` });
      continue;
    }
    const seen = new Set<string>();
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line === '') continue;
      const m = LINE.exec(line);
      if (m === null) {
        out.push({ code: 'RESULT_FORM', message: `${runner} prints a line that is not CASE <file> <id> PASS|FAIL: ${line}` });
        continue;
      }
      const [, caseFile = '', id = '', status = '', reason = ''] = m;
      const k = key(caseFile, id);
      if (!expectedKeys.has(k)) {
        out.push({ code: 'RESULT_UNKNOWN_ID', message: `${runner} prints ${caseFile} ${id}, which no case file names for it` });
        continue;
      }
      if (seen.has(k)) {
        out.push({ code: 'RESULT_DUPLICATE', message: `${runner} prints ${caseFile} ${id} twice` });
        continue;
      }
      seen.add(k);
      if (status === 'FAIL') out.push({ code: 'RESULT_FAIL', message: `${runner} ${caseFile} ${id} failed: ${reason}` });
    }
    for (const c of expected) {
      if (!seen.has(key(c.file, c.id))) out.push({ code: 'RESULT_MISSING', message: `${runner} prints no line for ${c.file} ${c.id}` });
    }
  }
  return out;
}
