// The results of the case runners (HYR-7): each runner writes `CASE <file> <id> PASS|FAIL <reason>` per case to the
// results file that the check is given, and the check takes success from these lines and from the exit status alone.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LANGS, type Finding, type Lang, type Spec } from './types.mts';

export type Results = Partial<Record<Lang, string>>;

type CaseId = { file: string; id: string; languages: Lang[] };

const LINE = /^CASE (\S+) (\S+) (PASS|FAIL)(?: (.*))?$/;

/** The languages a case names in its `only`; a case without `only` counts for all of them. */
function onlyLanguages(only: unknown): Lang[] {
  if (typeof only !== 'object' || only === null || !('languages' in only) || !Array.isArray(only.languages)) return LANGS;
  return LANGS.filter((l) => only.languages.includes(l));
}

/** The case ids of a case file: the `id` of each object in its top-level arrays. */
function caseIds(file: string, data: unknown): CaseId[] {
  if (typeof data !== 'object' || data === null) return [];
  const out: CaseId[] = [];
  for (const value of Object.values(data)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item !== 'object' || item === null || !('id' in item) || typeof item.id !== 'string') continue;
      const only = 'only' in item ? item.only : undefined;
      out.push({ file, id: item.id, languages: onlyLanguages(only) });
    }
  }
  return out;
}

/** Checks the result lines of each language against the cases of the spec; a case without a line fails. */
export function checkResults(root: string, spec: Spec, results: Results): Finding[] {
  const out: Finding[] = [];
  const files = [...new Set(spec.concerns.flatMap((c) => (Array.isArray(c.cases) ? c.cases : [])))];
  const cases: CaseId[] = [];
  for (const file of files) {
    const full = path.join(root, file);
    if (existsSync(full)) cases.push(...caseIds(file, JSON.parse(readFileSync(full, 'utf8'))));
  }
  const key = (file: string, id: string): string => `${file}\t${id}`;

  for (const lang of LANGS) {
    const expected = cases.filter((c) => c.languages.includes(lang));
    const expectedKeys = new Set(expected.map((c) => key(c.file, c.id)));
    const file = results[lang];
    if (file === undefined || !existsSync(file)) {
      for (const c of expected) out.push({ code: 'RESULT_MISSING', message: `${lang} prints no line for ${c.file} ${c.id}` });
      continue;
    }
    const seen = new Set<string>();
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line === '') continue;
      const m = LINE.exec(line);
      if (m === null) {
        out.push({ code: 'RESULT_FORM', message: `${lang} prints a line that is not CASE <file> <id> PASS|FAIL: ${line}` });
        continue;
      }
      const [, caseFile = '', id = '', status = '', reason = ''] = m;
      const k = key(caseFile, id);
      if (!expectedKeys.has(k)) {
        out.push({ code: 'RESULT_UNKNOWN_ID', message: `${lang} prints ${caseFile} ${id}, which the spec does not name for it` });
        continue;
      }
      if (seen.has(k)) {
        out.push({ code: 'RESULT_DUPLICATE', message: `${lang} prints ${caseFile} ${id} twice` });
        continue;
      }
      seen.add(k);
      if (status === 'FAIL') out.push({ code: 'RESULT_FAIL', message: `${lang} ${caseFile} ${id} failed: ${reason}` });
    }
    for (const c of expected) {
      if (!seen.has(key(c.file, c.id))) out.push({ code: 'RESULT_MISSING', message: `${lang} prints no line for ${c.file} ${c.id}` });
    }
  }
  return out;
}
