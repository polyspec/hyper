// The case files of the spec (HYR-9): which concern names them, how they are shaped, their rules and quotes, their
// `only`s, and the case reader of each language, which must hold the same members in all three languages (HYR-8).

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LANGS, type CaseField, type CaseFile, type Lang, type Only, type Spec } from './types.mts';
import type { Ctx } from './context.mts';
import { isSentenceOf, rulesOf } from './rules.mts';
import { words } from './names.mts';

const COMPARE_KINDS = ['exact', 'ordered', 'subset', 'absent', 'contains', 'excludes', 'prefix', 'keys', 'raises'];

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The key of a case file in `caseFiles`: its name in contracts/, `contracts/csrf.json` gives `csrf.json`. */
export function keyOf(file: string): string {
  return path.basename(file);
}

/** The case file's data, or undefined when the file is missing. */
function dataOf(root: string, key: string): unknown {
  const full = path.join(root, 'contracts', key);
  return existsSync(full) ? JSON.parse(readFileSync(full, 'utf8')) : undefined;
}

/** The fields of a section and all fields nested in them. */
function fieldsDeep(fields: Record<string, CaseField>): CaseField[] {
  return Object.values(fields).flatMap((f) => [f, ...fieldsDeep(f.fields ?? {})]);
}

/** Every `only` of a case: the item's own, those of outcomes and those of fields (HYR-9). */
export function caseOnlys(spec: Spec, root: string): Only[] {
  const out: Only[] = [];
  for (const [key, entry] of Object.entries(spec.caseFiles)) {
    const data = dataOf(root, key);
    for (const [name, section] of Object.entries(entry.sections)) {
      if (isObject(data) && Array.isArray(data[name])) {
        for (const item of data[name]) if (isObject(item) && isObject(item.only)) out.push(item.only as unknown as Only);
      }
      for (const o of Object.values(section.outcomes ?? {})) if (o.only) out.push(o.only);
      for (const f of fieldsDeep(section.fields)) if (f.only) out.push(f.only);
    }
  }
  return out;
}

/** HYR-9: a compare names a known kind and carries its rule and a quote, which is one sentence of the rule. */
function checkCompare(ctx: Ctx, where: string, rule: string | undefined, compare: string | undefined, quote: string | undefined): void {
  const { protocol, add } = ctx;
  if (compare === undefined || rule === undefined || quote === undefined) {
    add('CASE_COMPARE', `${where} lacks compare, rule or quote`);
    return;
  }
  if (!COMPARE_KINDS.includes(compare)) add('CASE_COMPARE', `${where} uses compare ${compare}, which is not a kind of HYR-9`);
  if (!rulesOf(protocol).has(rule)) add('RULE_UNKNOWN', `${where} names ${rule}, which is not a rule of protocol.md`);
  else if (!isSentenceOf(protocol, rule, quote)) add('CASE_QUOTE', `${where} quotes ${rule} with a text that is not one whole sentence of it: ${quote}`);
}

/** The case file of each concern, the shape of each file and its items, and the compares of its sections. */
function checkFiles(ctx: Ctx, entries: [string, CaseFile][]): void {
  const { spec, root, add } = ctx;
  for (const [key, entry] of entries) {
    const data = dataOf(root, key);
    if (!isObject(data)) {
      add('CASEFILE_UNKNOWN', `caseFiles ${key} has no contracts/${key} file that holds an object`);
      continue;
    }
    for (const fixture of Object.keys(entry.fixtures)) {
      if (!(fixture in data)) add('CASE_SECTION_UNKNOWN', `${key} declares fixture ${fixture}, which the file does not hold`);
    }
    for (const [name, section] of Object.entries(entry.sections)) {
      const items = data[name];
      if (!Array.isArray(items)) {
        add('CASE_SECTION_UNKNOWN', `${key} declares section ${name}, which the file does not hold as a list`);
        continue;
      }
      for (const use of section.uses) if (!(use in entry.fixtures)) add('FILE_UNDECLARED', `${key} section ${name} uses ${use}, an undeclared fixture`);
      for (const item of items) {
        if (!isObject(item)) {
          add('FILE_UNDECLARED', `${key} section ${name} holds an item that is not an object`);
          continue;
        }
        for (const k of Object.keys(item)) {
          if (k !== 'only' && !(k in section.fields)) add('FILE_UNDECLARED', `${key} section ${name} holds ${k}, which the spec does not declare`);
        }
      }
      for (const [field, f] of Object.entries(section.fields)) {
        if (f.optional !== true && !items.some((it) => isObject(it) && field in it)) {
          add('CASE_FIELD_UNKNOWN', `${key} section ${name} declares field ${field}, which no case holds`);
        }
      }
      for (const [outcome, o] of Object.entries(section.outcomes ?? {})) checkCompare(ctx, `${key} outcome ${outcome}`, o.rule, o.compare, o.quote);
      for (const f of fieldsDeep(section.fields)) {
        if (f.role === 'expected' && f.fields === undefined && f.compare === undefined) {
          add('CASE_COMPARE', `${key} section ${name} has an expected field without a compare`);
        }
        if (f.compare !== undefined || f.rule !== undefined || f.quote !== undefined) {
          checkCompare(ctx, `${key} section ${name} field ${f.role}`, f.rule, f.compare, f.quote);
        }
      }
    }
  }
}

/** HYR-9 and HYR-2: each case file of a concern is in caseFiles with a rule the concern lists, and no entry is unused. */
function checkCoverage(ctx: Ctx): Set<string> {
  const { spec, root, add } = ctx;
  const named = new Set<string>();
  for (const c of spec.concerns) {
    if (Array.isArray(c.cases)) {
      for (const file of c.cases) {
        const key = keyOf(file);
        named.add(key);
        if (!existsSync(path.join(root, file))) {
          add('CASE_MISSING', `${file} is named by concern ${c.id} and missing`);
          continue;
        }
        const entry = spec.caseFiles[key];
        if (entry === undefined) {
          add('CASEFILE_MISSING', `${file} is named by concern ${c.id} and has no caseFiles entry`);
          continue;
        }
        if (!c.rules.includes(entry.rule)) add('CASE_RULE', `${file} has rule ${entry.rule}, concern ${c.id} lists ${c.rules.join(', ')}`);
      }
    } else {
      if (c.cases.none.trim() === '') add('CASE_REASON', `concern ${c.id} has an empty reason for cases none`);
      if (c.units.some((u) => u.only?.languages.length !== 1)) {
        add('CASES_NONE', `concern ${c.id} has cases none but a unit without an only for one language`);
      }
    }
  }
  for (const key of Object.keys(spec.caseFiles)) {
    if (!named.has(key)) add('CASEFILE_UNKNOWN', `caseFiles ${key} is named by no concern`);
  }
  return named;
}

/** HYR-8: the case reader of each language is a class that holds the same public and private members as in the others. */
function checkReaders(ctx: Ctx): void {
  const { spec, add } = ctx;
  const shapes = new Map<Lang, string>();
  for (const lang of LANGS) {
    const ref = spec.languages[lang].caseReader;
    const [file, name] = ref.split('::');
    if (file === undefined || name === undefined) {
      add('CASE_READER_MISSING', `${lang} caseReader ${ref} is not file::class`);
      continue;
    }
    let src;
    try {
      src = ctx.readDir(lang, path.posix.dirname(file));
    } catch (err) {
      add('CASE_READER_MISSING', `${lang} caseReader ${file} could not be read: ${(err as Error).message}`);
      continue;
    }
    if (!src.units.some((u) => u.file === file && u.name === name)) {
      add('CASE_READER_MISSING', `${lang} caseReader ${ref} names no class of that name in ${file}`);
      continue;
    }
    const members = src.members.filter((m) => m.file === file && m.unit === name);
    const pub = members.filter((m) => m.visibility === 'public').map((m) => words(m.name)).sort();
    const priv = members.filter((m) => m.visibility !== 'public').map((m) => words(m.name)).sort();
    shapes.set(lang, JSON.stringify({ pub, priv }));
  }
  const [first, ...rest] = LANGS.filter((l) => shapes.has(l));
  if (first === undefined) return;
  for (const lang of rest) {
    if (shapes.get(lang) !== shapes.get(first)) add('CASE_READER_MEMBERS', `${lang} case reader holds other members than ${first} (HYR-8)`);
  }
}

export function checkCases(ctx: Ctx): void {
  const named = checkCoverage(ctx);
  const entries = Object.entries(ctx.spec.caseFiles).filter(([key]) => named.has(key));
  checkFiles(ctx, entries);
  checkReaders(ctx);
}
