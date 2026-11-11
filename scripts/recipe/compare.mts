// The comparison of the development spec with the readers' output (HYR-8). Each finding carries the code that the
// recipe check prints; the codes are listed with the mutation cases of tests/scripts/fixtures/recipe.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LANGS, type Finding, type Lang, type Member, type Only, type Sources, type Spec, type Unit, type Visibility } from './types.mts';

const CTOR_NAMES = ['__construct', '__init__', 'constructor'];

/** Words of a name, lowercased and joined by `-`: `MediaType`, `media-type` and `media_type` all give `media-type`. */
export function words(name: string): string {
  return name
    .replace(/^_+/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w !== '')
    .map((w) => w.toLowerCase())
    .join('-');
}

/** The file name HYR-4 gives a unit: PascalCase for PHP, kebab for Node, snake for Python with `_` when internal. */
function expectedFile(lang: Lang, id: string, internal: boolean): string {
  const parts = id.split('-');
  if (lang === 'php') return `${parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('')}.php`;
  if (lang === 'node') return `${id}.ts`;
  return `${internal ? '_' : ''}${parts.join('_')}.py`;
}

/** Member key of the spec and of a reader member: constructors share one key whatever the language calls them. */
function specKey(m: Member): string {
  return m.kind === 'constructor' ? 'constructor' : words(m.id.slice(m.id.indexOf('.') + 1));
}
export function readerKey(name: string, kind: string): string {
  return kind === 'constructor' || CTOR_NAMES.includes(name) ? 'constructor' : words(name);
}

/** Python has no `private`: a private member is `_`-prefixed and reads as internal. */
function expectedVisibility(lang: Lang, v: Visibility): Visibility {
  return lang === 'python' && v === 'private' ? 'internal' : v;
}

/** The test key of a native test reference `<file>::<name>: <reason>`. */
function testKey(ref: string): string {
  const at = ref.indexOf(': ', ref.indexOf('::') + 2);
  return at < 0 ? ref : ref.slice(0, at);
}

export function compare(spec: Spec, sources: Record<Lang, Sources>, root: string, protocol: string): Finding[] {
  const out: Finding[] = [];
  const add = (code: string, message: string): void => {
    out.push({ code, message });
  };
  const units = spec.concerns.flatMap((c) => c.units);
  // The rules of protocol.md are its definition lines `- **HY-n** ...`; a mention of HY-n in prose defines no rule.
  const rules = new Set(protocol.split('\n').flatMap((line) => line.match(/^\s*-\s*\*\*(HY-\d+)\*\*/u)?.[1] ?? []));
  const flat = protocol.replace(/\s+/g, ' ');

  // Every `only` of the spec, with its unit, member, type or field.
  const onlys: Only[] = [];
  for (const u of units) {
    if (u.only) onlys.push(u.only);
    for (const m of u.members) if (m.only) onlys.push(m.only);
  }
  for (const t of spec.types) {
    if (t.only) onlys.push(t.only);
    for (const f of Object.values(t.shape.fields ?? {})) if (typeof f !== 'string' && f.only) onlys.push(f.only);
  }

  // HYR-2 and HYR-6: rules exist in protocol.md; a quote is a sentence of it.
  for (const r of [...spec.concerns.flatMap((c) => c.rules), ...spec.outside.map((o) => o.rule), ...onlys.map((o) => o.rule)]) {
    if (!rules.has(r)) add('RULE_UNKNOWN', `${r} is not a rule of protocol.md`);
  }
  // HYR-2: every rule of protocol.md is named by a concern or by outside; outside names no rule of a concern.
  const concernRules = new Set(spec.concerns.flatMap((c) => c.rules));
  for (const o of spec.outside) {
    if (o.reason.trim() === '') add('OUTSIDE_REASON', `outside ${o.rule} has an empty reason`);
    if (concernRules.has(o.rule)) add('OUTSIDE_CONCERN', `${o.rule} is named by a concern and by outside`);
  }
  for (const r of rules) {
    if (!concernRules.has(r) && !spec.outside.some((o) => o.rule === r)) add('RULE_UNCOVERED', `${r} is named by no concern and no outside entry`);
  }
  for (const o of onlys) {
    if (!flat.includes(o.quote.replace(/\s+/g, ' '))) add('ONLY_QUOTE', `quote of ${o.rule} is not a sentence of protocol.md: ${o.quote}`);
  }

  // HYR-7: runners and native tests exist; every reader test is named by the spec.
  const readerTests = new Set(LANGS.flatMap((l) => sources[l].tests.map((t) => `${t.file}::${t.name}`)));
  const named = new Set<string>();
  for (const lang of LANGS) {
    named.add(spec.languages[lang].runner);
    if (!readerTests.has(spec.languages[lang].runner)) add('RUNNER_MISSING', `${lang} runner ${spec.languages[lang].runner} is not a test`);
  }
  // HYR-7: a native test is named with a reason, and lies in the test tree of the one language that its scope names.
  const nativeTest = (ref: string, label: string, scope: Lang[] | undefined): void => {
    const key = testKey(ref);
    named.add(key);
    if (ref.slice(key.length + 2).trim() === '') add('NATIVE_REASON', `${label} names native test ${key} without a reason`);
    if (scope !== undefined && scope.length !== 1) add('NATIVE_SCOPE', `${label} names native test ${key} but its only does not name exactly one language`);
    const lang = scope?.length === 1 ? scope[0] : undefined;
    const tests = lang === undefined ? [...readerTests] : sources[lang].tests.map((t) => `${t.file}::${t.name}`);
    if (!tests.includes(key)) add('NATIVE_TEST_MISSING', `${label} names native test ${key}, which is not a test`);
  };
  for (const c of spec.concerns) {
    if (Array.isArray(c.cases)) {
      for (const file of c.cases) {
        const full = path.join(root, file);
        if (!existsSync(full)) {
          add('CASE_MISSING', `${file} is named by concern ${c.id} and missing`);
          continue;
        }
        const data: unknown = JSON.parse(readFileSync(full, 'utf8'));
        const rule = typeof data === 'object' && data !== null && 'rule' in data ? data.rule : undefined;
        if (typeof rule !== 'string' || !c.rules.includes(rule)) add('CASE_RULE', `${file} has rule ${String(rule)}, concern ${c.id} lists ${c.rules.join(', ')}`);
      }
    } else {
      if (c.cases.none.trim() === '') add('CASE_REASON', `concern ${c.id} has an empty reason for cases none`);
      for (const ref of c.cases.tests) nativeTest(ref, `concern ${c.id}`, undefined);
      if (units.length > 0 && c.units.some((u) => u.only?.languages.length !== 1)) {
        add('CASES_NONE', `concern ${c.id} has cases none but a unit without an only for one language`);
      }
    }
  }
  for (const u of units) {
    for (const ref of u.tests ?? []) nativeTest(ref, `unit ${u.id}`, u.only?.languages ?? []);
    for (const m of u.members) for (const ref of m.tests ?? []) nativeTest(ref, `member ${m.id}`, m.only?.languages ?? []);
  }
  for (const key of readerTests) {
    if (!named.has(key)) add('TEST_UNNAMED', `${key} is a test that the spec does not name`);
  }

  // HYR-4 and HYR-3: files are owned by a unit or a barrel, and the units are where the spec says.
  for (const lang of LANGS) {
    const owned = new Set<string>(spec.languages[lang].barrel);
    for (const c of spec.concerns) for (const u of c.units) {
      const n = u.native[lang];
      if (n) owned.add(n.file);
    }
    for (const f of sources[lang].files) if (!owned.has(f)) add('FILE_UNOWNED', `${lang} file ${f} is named by no unit or barrel`);
    for (const f of owned) if (!sources[lang].files.includes(f)) add('FILE_MISSING', `${lang} file ${f} is named by the spec and missing`);
  }
  for (const u of units) {
    checkOnly(add, `unit ${u.id}`, u.native, LANGS, u.only);
    for (const lang of LANGS) {
      const n = u.native[lang];
      if (!n) continue;
      const candidates = sources[lang].units.filter((r) => words(r.name) === u.id);
      const found = candidates.find((r) => r.file === n.file);
      if (found === undefined) {
        add(candidates.length > 0 ? 'UNIT_FILE' : 'UNIT_MISSING', `${lang} unit ${u.id} is not in ${n.file}`);
      } else {
        if (found.kind !== n.kind) add('UNIT_KIND', `${lang} unit ${u.id} is ${found.kind}, spec says ${n.kind}`);
        if (found.internal !== n.internal) add('UNIT_VISIBILITY', `${lang} unit ${u.id} internal=${found.internal}, spec says ${n.internal}`);
      }
      const base = n.file.split('/').pop() ?? '';
      if (base !== expectedFile(lang, u.id, n.internal)) add('UNIT_FILE', `${lang} unit ${u.id} file ${base} should be ${expectedFile(lang, u.id, n.internal)}`);
    }
  }
  for (const lang of LANGS) {
    const listed = new Set(units.filter((u) => u.native[lang]).map((u) => u.id));
    for (const r of sources[lang].units) {
      if (r.kind !== 'interface' && !listed.has(words(r.name))) add('UNIT_COUNT', `${lang} ${r.file} declares unit ${r.name} that the spec does not list`);
    }
  }

  // HYR-5: members.
  for (const u of units) {
    for (const lang of LANGS) {
      const n = u.native[lang];
      if (!n) continue;
      const unitMembers = sources[lang].members.filter((r) => words(r.unit) === u.id);
      for (const m of u.members) {
        checkOnly(add, `member ${m.id}`, m.native, u.only?.languages ?? LANGS, m.only);
        const mn = m.native[lang];
        if (!mn) continue;
        const cands = unitMembers.filter((r) => readerKey(r.name, r.kind) === specKey(m));
        const found = cands.find((r) => r.file === n.file) ?? cands[0];
        if (found === undefined) {
          add('MEMBER_MISSING', `${lang} member ${m.id} is missing`);
          continue;
        }
        if (found.file !== n.file || found.symbol !== mn.symbol) add('MEMBER_MOVED', `${lang} member ${m.id} is at ${found.symbol}, spec says ${mn.symbol}`);
        if (found.signature !== mn.signature || found.kind !== m.kind || found.parameters.length !== m.inputs.length) {
          add('MEMBER_SIGNATURE', `${lang} member ${m.id} is "${found.signature}", spec says "${mn.signature}"`);
        }
        if (found.visibility !== expectedVisibility(lang, m.visibility)) {
          add('MEMBER_VISIBILITY', `${lang} member ${m.id} is ${found.visibility}, spec says ${m.visibility}`);
        }
      }
      for (const r of unitMembers) {
        if (!u.members.some((m) => m.native[lang] && specKey(m) === readerKey(r.name, r.kind))) {
          add('MEMBER_ADDED', `${lang} ${r.symbol} is not in the spec`);
        }
      }
      // HYR-5 private members are used by name nowhere else.
      for (const m of u.members.filter((x) => x.visibility === 'private' && x.native[lang])) {
        const name = specKey(m);
        for (const use of sources[lang].uses.filter((x) => words(x.name) === name && x.file !== n.file)) {
          add('PRIVATE_USED', `${lang} ${use.file} uses private member ${m.id} by name`);
        }
      }
    }
  }

  // HYR-5 constants: none is public.
  for (const lang of LANGS) {
    for (const c of sources[lang].constants) {
      if (c.visibility === 'public') add('CONST_PUBLIC', `${lang} ${c.file} constant ${c.name} is public without @internal`);
    }
  }

  // HYR-3 types, HYR-2 shapes.
  for (const t of spec.types) {
    checkOnly(add, `type ${t.id}`, t.native, LANGS, t.only);
    for (const lang of LANGS) {
      const n = t.native[lang];
      if (!n) continue;
      const [file, name] = n.symbol.split('::');
      const rt = sources[lang].types.find((r) => words(r.name) === words(t.id));
      if (rt === undefined || rt.file !== file) {
        add('TYPE_MISSING', `${lang} type ${t.id} is not in ${file}`);
        continue;
      }
      if (rt.name !== name) add('TYPE_MISSING', `${lang} type ${t.id} is named ${rt.name}, spec says ${name}`);
      if (rt.declaration !== n.declaration) add('TYPE_CHANGED', `${lang} type ${t.id} declaration differs from spec`);
      if (rt.visibility !== expectedVisibility(lang, t.visibility)) add('TYPE_VISIBILITY', `${lang} type ${t.id} is ${rt.visibility}, spec says ${t.visibility}`);
      const fields = t.shape.fields;
      if (fields !== undefined && rt.fields !== undefined) {
        if (Object.keys(fields).sort().join(',') !== [...rt.fields].sort().join(',')) add('TYPE_SHAPE', `${lang} type ${t.id} fields differ from spec`);
      }
    }
  }
  for (const lang of LANGS) {
    const listedTypes = new Set(spec.types.filter((t) => t.native[lang]).map((t) => words(t.id)));
    const unitIds = new Set(units.filter((u) => u.native[lang]).map((u) => u.id));
    for (const r of sources[lang].types) {
      if (!listedTypes.has(words(r.name)) && !unitIds.has(words(r.name))) add('TYPE_UNLISTED', `${lang} ${r.file} declares type ${r.name} that the spec does not list`);
    }
  }

  // HYR-2 barrels: the re-exports are the public units and public types.
  for (const lang of LANGS) {
    const barrels = spec.languages[lang].barrel;
    if (barrels.length === 0) continue;
    const exported = new Set(sources[lang].exports.filter((e) => barrels.includes(e.file)).map((e) => e.name));
    const expected = new Set<string>();
    for (const u of units) {
      const n = u.native[lang];
      if (!n || n.internal) continue;
      const r = sources[lang].units.find((x) => x.file === n.file && words(x.name) === u.id);
      if (r) expected.add(r.name);
    }
    for (const t of spec.types) {
      const n = t.native[lang];
      if (n && t.visibility === 'public') expected.add(n.symbol.split('::')[1] ?? t.id);
    }
    const extra = [...exported].filter((x) => !expected.has(x));
    const missing = [...expected].filter((x) => !exported.has(x));
    if (extra.length > 0 || missing.length > 0) {
      add('BARREL_EXPORT', `${lang} barrel exports differ: extra [${extra.join(', ')}], missing [${missing.join(', ')}]`);
    }
  }
  return out;
}

/** HYR-6: the languages a unit, member or type has native code for are exactly its `only` languages, or all of them. */
function checkOnly(
  add: (code: string, message: string) => void,
  label: string,
  native: Partial<Record<Lang, unknown>>,
  scope: Lang[],
  only: Only | undefined,
): void {
  const wanted = only?.languages ?? scope;
  for (const lang of LANGS) {
    const has = native[lang] !== undefined;
    const want = wanted.includes(lang);
    if (has && !want) add('ONLY_MISMATCH', `${label} has ${lang} native code its only excludes`);
    if (!has && want) add('ONLY_MISSING', `${label} has no ${lang} native code and no only excludes ${lang}`);
  }
}
