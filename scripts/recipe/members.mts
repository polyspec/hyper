// Members, terms and `only` of the recipe check (HYR-5, HYR-6): each member is where the spec says with its signature and
// visibility, its terms are in the vocabulary, its native name is the one HYR-5 gives, and an options record names the
// parameters of the member that takes it.

import { LANGS, type Lang, type Member, type Only, type Runner, type Spec } from './types.mts';
import type { Ctx } from './context.mts';
import { errorKnown, expectedNative, expectedVisibility, hasAcronym, readerKey, specKey, symbolName, termKnown, words } from './names.mts';

/** The terms of the vocabulary (HYR-5): the units and types of the spec. */
export function vocabulary(spec: Spec): Set<string> {
  return new Set([...spec.concerns.flatMap((c) => c.units.map((u) => u.id)), ...spec.types.map((t) => t.id)]);
}

/** The terms of the vocabulary (HYR-5): the units and types of the spec, and the terms of protocol.json. */
export function termsOf(spec: Spec, protocol: Ctx['protocol']): Set<string> {
  return new Set([...vocabulary(spec), ...protocol.terms]);
}

/** HYR-6: the languages a unit, member or type has native code for are exactly its `only` languages, or all of them. */
export function checkOnly(
  add: (code: string, message: string) => void,
  label: string,
  native: Partial<Record<Lang, unknown>>,
  scope: readonly Runner[],
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

/** HYR-5 options record: the fields of the record that apply to a language, as words. */
function recordNames(spec: Spec, term: string, lang: Lang): string[] | undefined {
  const t = spec.types.find((x) => x.id === term);
  if (t === undefined || t.shape.fields === undefined) return undefined;
  return Object.entries(t.shape.fields)
    .filter(([, f]) => typeof f === 'string' || f.only === undefined || f.only.languages.includes(lang))
    .map(([key]) => words(key.replace(/^["']|["']$/gu, '')))
    .sort();
}

export function checkMembers(ctx: Ctx): void {
  const { spec, sources, add } = ctx;
  const units = spec.concerns.flatMap((c) => c.units);
  const ids = termsOf(spec, ctx.protocol);
  const checkTerm = (where: string, term: string): void => {
    if (!termKnown(term, ids)) add('TERM_UNKNOWN', `${where} uses ${term}, which is outside the vocabulary (HYR-5)`);
  };
  for (const u of units) {
    for (const m of u.members) {
      m.inputs.forEach((t, i) => checkTerm(`${m.id} input ${i + 1}`, t));
      checkTerm(`${m.id} output`, m.output);
      for (const t of m.errors) {
        if (!errorKnown(t, ids, ctx.protocol.statuses.replace(/\s+/gu, ' '))) add('TERM_UNKNOWN', `${m.id} error ${t} is neither a status of protocol.json nor an error unit`);
      }
    }
  }

  for (const u of units) {
    checkOnly(add, `unit ${u.id}`, u.native, LANGS, u.only);
    for (const lang of LANGS) {
      if (!u.native[lang]) continue;
      const unitMembers = sources[lang].members.filter((r) => words(r.unit) === u.id);
      for (const m of u.members) {
        checkMember(ctx, lang, u, m, unitMembers);
      }
      for (const r of unitMembers) {
        // HYR-5: a private property is not a member of the public API; the readers report it, the spec does not list it.
        if (r.kind === 'property' && r.visibility !== 'public') continue;
        if (!u.members.some((m) => m.native[lang] && specKey(m) === readerKey(r.name, r.kind))) {
          add('MEMBER_ADDED', `${lang} ${r.symbol} is not in the spec`);
        }
      }
      for (const m of u.members.filter((x) => x.visibility === 'private' && x.native[lang])) {
        const name = specKey(m);
        for (const use of sources[lang].uses.filter((x) => words(x.name) === name && x.file !== u.native[lang]?.file)) {
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
}

function checkMember(
  ctx: Ctx,
  lang: Lang,
  u: { id: string; only?: Only; members: Member[] },
  m: Member,
  unitMembers: Ctx['sources'][Lang]['members'],
): void {
  const { spec, add } = ctx;
  checkOnly(add, `member ${m.id}`, m.native, u.only?.languages ?? LANGS, m.only);
  if (hasAcronym(m.id)) add('NAME_ACRONYM', `member ${m.id} holds two capitals in a row (HYR-4)`);
  const mn = m.native[lang];
  if (!mn) return;
  const cands = unitMembers.filter((r) => readerKey(r.name, r.kind) === specKey(m));
  const found = cands.find((r) => r.symbol === mn.symbol) ?? cands[0];
  if (found === undefined) {
    add('MEMBER_MISSING', `${lang} member ${m.id} is missing`);
    return;
  }
  if (found.symbol !== mn.symbol) add('MEMBER_MOVED', `${lang} member ${m.id} is at ${found.symbol}, spec says ${mn.symbol}`);
  if (found.signature !== mn.signature || found.kind !== m.kind || found.parameters.length !== m.inputs.length) {
    add('MEMBER_SIGNATURE', `${lang} member ${m.id} is "${found.signature}", spec says "${mn.signature}"`);
  }
  if (found.visibility !== expectedVisibility(lang, m.visibility)) {
    add('MEMBER_VISIBILITY', `${lang} member ${m.id} is ${found.visibility}, spec says ${m.visibility}`);
  }
  const native = expectedNative(lang, m, mn.symbol.split('::')[0]);
  const name = symbolName(mn.symbol);
  if (native !== undefined && name !== native) add('MEMBER_NAME', `${lang} member ${m.id} is named ${name}, HYR-5 says ${native}`);
  if (hasAcronym(name)) add('NAME_ACRONYM', `${lang} member ${m.id} is named ${name}, which holds two capitals in a row (HYR-4)`);
  // HYR-5 options record: a member that takes a record names its parameters after the record's fields in each language.
  for (const term of m.inputs) {
    const fields = recordNames(spec, term, lang);
    if (fields === undefined || found.parameters.length === 1) continue;
    const params = found.parameters.map((p) => words(p)).sort();
    if (params.join(',') !== fields.join(',')) add('OPTIONS_MISMATCH', `${lang} member ${m.id} takes ${found.parameters.join(', ')}; record ${term} has ${fields.join(', ')}`);
  }
}
