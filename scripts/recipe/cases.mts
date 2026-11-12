// The case files of the spec (HYR-9): which concern names them, how they are shaped, their statements, the rules their
// items require, their `only`s, the runners that get cases, and the case reader of each language (HYR-8).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LANGS, type CaseField, type CaseFile, type Only, type Runner, type Spec } from './types.mts';
import type { Ctx } from './context.mts';
import { checkRuleId, checkStatement, rulesOfFile } from './rules.mts';
import { readerKey } from './names.mts';

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

/** The fields an item states: the section's fields it holds, and those nested in the objects it holds. */
function statedFields(fields: Record<string, CaseField>, item: Json): CaseField[] {
  return Object.entries(fields).flatMap(([name, f]) => {
    if (!(name in item)) return [];
    const value = item[name];
    return [f, ...(f.fields !== undefined && isObject(value) ? statedFields(f.fields, value) : [])];
  });
}

/** True when a case or field with this `only` runs for the runner. */
function keeps(only: Only | undefined, runner: Runner): boolean {
  return only === undefined || only.languages.includes(runner);
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

/** HYR-9: a compare names a known kind and a statement of protocol.json; returns the statement's rule when it is one. */
function checkCompare(ctx: Ctx, where: string, compare: string | undefined, sentence: string | undefined): string | undefined {
  if (compare === undefined || sentence === undefined) {
    ctx.add('CASE_COMPARE', `${where} lacks compare or sentence`);
    return undefined;
  }
  if (!COMPARE_KINDS.includes(compare)) ctx.add('CASE_COMPARE', `${where} uses compare ${compare}, which is not a kind of HYR-9`);
  return checkStatement(ctx, where, sentence);
}

/** HYR-9 and HYR-2: each case file of a concern is in caseFiles, and each caseFiles entry is named by a concern. */
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
        if (spec.caseFiles[key] === undefined) add('CASEFILE_MISSING', `${file} is named by concern ${c.id} and has no caseFiles entry`);
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

/** HYR-9: each case file of contracts/ is named by a caseFiles entry; the spec and the protocol are not case files. */
function checkListed(ctx: Ctx): void {
  const { spec, root, add } = ctx;
  const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'contracts'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((f) => f.endsWith('.json') && path.dirname(f) === 'contracts');
  const keys = new Set(Object.keys(spec.caseFiles));
  for (const file of listed) {
    const key = path.basename(file);
    if (key === 'interfaces.json' || key === 'protocol.json' || keys.has(key)) continue;
    add('CASEFILE_UNLISTED', `${file} is a case file that caseFiles does not name`);
  }
}

/** HYR-9: the shape of each case file, its items and its sections; the compares, requirements and runners of each. */
function checkFiles(ctx: Ctx, entries: [string, CaseFile][]): void {
  const { spec, root, add } = ctx;
  const memberIds = new Set(spec.concerns.flatMap((c) => c.units.flatMap((u) => u.members.map((m) => m.id))));
  for (const [key, entry] of entries) {
    const data = dataOf(root, key);
    if (!isObject(data)) {
      add('CASEFILE_UNKNOWN', `caseFiles ${key} has no contracts/${key} file that holds an object`);
      continue;
    }
    const concernRules = rulesOfFile(spec, `contracts/${key}`);
    for (const fixture of Object.keys(entry.fixtures)) {
      if (!(fixture in data)) add('CASE_SECTION_UNKNOWN', `${key} declares fixture ${fixture}, which the file does not hold`);
    }
    for (const [name, section] of Object.entries(entry.sections)) {
      const where = `${key} section ${name}`;
      const items = data[name];
      if (!Array.isArray(items)) {
        add('CASE_SECTION_UNKNOWN', `${where} is declared, which the file does not hold as a list`);
        continue;
      }
      for (const use of section.uses) if (!(use in entry.fixtures)) add('FILE_UNDECLARED', `${where} uses ${use}, an undeclared fixture`);
      // HYR-9: a section names the members whose result it states, and each is a member of the spec.
      for (const member of section.members ?? []) if (!memberIds.has(member)) add('SECTION_MEMBER_UNKNOWN', `${where} names member ${member}, which the spec does not list`);
      const fieldRules = new Map<CaseField, string | undefined>();
      for (const f of fieldsDeep(section.fields)) {
        if (f.compare === undefined && f.sentence === undefined) continue;
        if (f.role === 'expected' && f.fields === undefined && (f.compare === undefined || f.sentence === undefined)) {
          add('CASE_COMPARE', `${where} has an expected field without a compare or sentence`);
          continue;
        }
        fieldRules.set(f, checkCompare(ctx, `${where} field ${f.role}`, f.compare, f.sentence));
      }
      const outcomeRules = new Set<string>();
      for (const [outcome, o] of Object.entries(section.outcomes ?? {})) {
        const rule = checkCompare(ctx, `${where} outcome ${outcome}`, o.compare, o.sentence);
        if (rule !== undefined) outcomeRules.add(rule);
      }
      for (const item of items) {
        if (!isObject(item)) {
          add('FILE_UNDECLARED', `${where} holds an item that is not an object`);
          continue;
        }
        for (const k of Object.keys(item)) {
          if (k !== 'only' && k !== 'requirements' && !(k in section.fields)) add('FILE_UNDECLARED', `${where} holds ${k}, which the spec does not declare`);
        }
        const requirements = item.requirements;
        if (requirements !== undefined && (!Array.isArray(requirements) || !requirements.every((r) => typeof r === 'string'))) {
          add('REQUIREMENT_FORM', `${where} holds requirements that are not a list of rule ids`);
        }
        const required = Array.isArray(requirements) ? requirements.filter((r): r is string => typeof r === 'string') : [];
        for (const r of required) checkRuleId(ctx, `${where} requirement`, r);
        const stated = statedFields(section.fields, item);
        const statedRules = new Set(stated.flatMap((f) => fieldRules.get(f) ?? []));
        if (new Set(required).size !== required.length || required.some((r) => statedRules.has(r))) {
          add('REQUIREMENT_REPEAT', `${where} requires a rule twice, or a rule that one of its fields already states`);
        }
        const effective = new Set([...required, ...statedRules, ...outcomeRules]);
        if (stated.some((f) => f.role === 'response') && effective.size === 0) {
          add('REQUIREMENT_EMPTY', `${where} holds a response with no rule to cover it`);
        }
        for (const r of effective) {
          if (spec.outside.some((o) => o.rule === r)) add('REQUIREMENT_OUTSIDE', `${where} requires ${r}, which is outside the spec`);
          else if (!concernRules.has(r)) add('REQUIREMENT_UNCOVERED', `${where} requires ${r}, which no concern of ${key} names`);
        }
      }
      for (const [field, f] of Object.entries(section.fields)) {
        if (f.optional !== true && !items.some((it) => isObject(it) && field in it)) {
          add('CASE_FIELD_UNKNOWN', `${where} declares field ${field}, which no case holds`);
        }
      }
      for (const runner of section.runners) {
        const outcomesKept = Object.values(section.outcomes ?? {}).some((o) => keeps(o.only, runner));
        const cased = items.some(
          (it) =>
            isObject(it) &&
            keeps(it.only as Only | undefined, runner) &&
            (outcomesKept ||
              statedFields(section.fields, it).some(
                (f) => f.fields === undefined && keeps(f.only, runner) && (f.role === 'response' || f.compare !== undefined),
              )),
        );
        if (!cased) add('CASE_EMPTY', `${where} gives runner ${runner} no case`);
      }
    }
  }
}

/** The words of the members that the first reader holds and the other lacks, and the words that the other adds (HYR-5 names). */
function differ(kind: string, first: string[], other: string[]): string {
  const missing = first.filter((w) => !other.includes(w));
  const extra = other.filter((w) => !first.includes(w));
  if (missing.length === 0 && extra.length === 0) return '';
  return `${kind} missing [${missing.join(', ')}], extra [${extra.join(', ')}]`;
}

/** HYR-8: the case reader of each language is a class that holds the same public and private members as in the others. */
function checkReaders(ctx: Ctx): void {
  const { spec, add } = ctx;
  const shapes = new Map<string, { pub: string[]; priv: string[] }>();
  for (const lang of LANGS) {
    const ref = spec.caseReaders[lang];
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
    // A constructor is no member of HYR-7, and Python has no private one, so it counts once whatever its visibility.
    const isPublic = (m: (typeof members)[number]): boolean => m.visibility === 'public' || readerKey(m.name, m.kind) === 'constructor';
    const pub = members.filter((m) => isPublic(m)).map((m) => readerKey(m.name, m.kind)).sort();
    const priv = members.filter((m) => !isPublic(m)).map((m) => readerKey(m.name, m.kind)).sort();
    shapes.set(lang, { pub, priv });
  }
  const [first, ...rest] = LANGS.filter((l) => shapes.has(l));
  if (first === undefined) return;
  const base = shapes.get(first);
  for (const lang of rest) {
    const other = shapes.get(lang);
    if (base === undefined || other === undefined) continue;
    const detail = [differ('public', base.pub, other.pub), differ('private', base.priv, other.priv)].filter((s) => s !== '');
    if (detail.length > 0) add('CASE_READER_MEMBERS', `${lang} case reader holds other members than ${first} (HYR-8): ${detail.join('; ')}`);
  }
}

export function checkCases(ctx: Ctx): void {
  const named = checkCoverage(ctx);
  checkListed(ctx);
  const entries = Object.entries(ctx.spec.caseFiles).filter(([key]) => named.has(key));
  checkFiles(ctx, entries);
  checkReaders(ctx);
}
