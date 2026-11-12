// Types of the recipe check (HYR-3, HYR-5): each type of the spec is where it says with its declaration and visibility,
// its shape (fields, optional fields and function parameters) is the one the reader sees, and a type is never a unit.

import { LANGS, type Lang } from './types.mts';
import type { Ctx } from './context.mts';
import { expectedVisibility, fieldWords, termKnown, words } from './names.mts';
import { checkOnly, termsOf } from './members.mts';

export function checkShapes(ctx: Ctx): void {
  const { spec, sources, add } = ctx;
  const units = spec.concerns.flatMap((c) => c.units);
  const unitIds = new Set(units.map((u) => u.id));
  const ids = termsOf(spec, ctx.protocol);
  for (const t of spec.types) {
    if (!unitIds.has(t.unit)) add('TYPE_UNIT', `type ${t.id} names unit ${t.unit}, which the spec does not list`);
    if (unitIds.has(words(t.id))) add('TYPE_IS_UNIT', `type ${t.id} has the words of a unit (HYR-3)`);
    for (const [field, f] of Object.entries(t.shape.fields ?? {})) {
      const term = typeof f === 'string' ? f : f.term;
      if (!termKnown(term, ids)) add('TERM_UNKNOWN', `${t.id} field ${field} uses ${term}, which is outside the vocabulary (HYR-5)`);
    }
    for (const field of t.shape.optional ?? []) {
      if (!(field in (t.shape.fields ?? {}))) add('TYPE_SHAPE', `${t.id} marks ${field} optional, which is no field of it`);
    }
    if (t.shape.term !== undefined && !termKnown(t.shape.term, ids)) add('TERM_UNKNOWN', `${t.id} uses ${t.shape.term}, which is outside the vocabulary (HYR-5)`);
    const fn = t.shape.function;
    fn?.inputs.forEach((term, i) => {
      if (!termKnown(term, ids)) add('TERM_UNKNOWN', `${t.id} function input ${i + 1} uses ${term}, which is outside the vocabulary (HYR-5)`);
    });
    if (fn?.output !== undefined && !termKnown(fn.output, ids)) add('TERM_UNKNOWN', `${t.id} function output uses ${fn.output}, which is outside the vocabulary (HYR-5)`);
  }

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
      const read = (rt.fields ?? []).map((f) => words(f.replace(/^["']|["']$/gu, ''))).sort();
      const want = t.shape.fields === undefined ? [] : fieldWords(t, lang);
      if (want.join(',') !== read.join(',')) add('TYPE_SHAPE', `${lang} type ${t.id} fields differ from spec`);
      const fn = t.shape.function;
      if (fn !== undefined && rt.parameters !== undefined && rt.parameters !== fn.inputs.length) {
        add('TYPE_SHAPE', `${lang} type ${t.id} takes ${rt.parameters} parameters, spec says ${fn.inputs.length}`);
      }
    }
  }

  // HYR-3: a type that has the words of a unit is a unit; a Node interface is a unit only with a unit of its words in
  // another language, and is otherwise a type.
  for (const lang of LANGS) {
    const listed = new Set(spec.types.filter((t) => t.native[lang]).map((t) => words(t.id)));
    const nodeInterface = (name: string): boolean => lang === 'node' && sources.node.units.some((u) => u.kind === 'interface' && u.name === name);
    for (const r of sources[lang].types) {
      const w = words(r.name);
      if (unitIds.has(w)) {
        if (!nodeInterface(r.name)) add('TYPE_IS_UNIT', `${lang} ${r.file} declares type ${r.name}, which has the words of a unit (HYR-3)`);
      } else if (!listed.has(w)) {
        add('TYPE_UNLISTED', `${lang} ${r.file} declares type ${r.name} that the spec does not list`);
      }
    }
  }
  for (const u of sources.node.units) {
    if (u.kind !== 'interface' || !unitIds.has(words(u.name))) continue;
    const counterpart = (['php', 'python'] as Lang[]).some((l) => sources[l].units.some((r) => words(r.name) === words(u.name)));
    if (!counterpart) add('INTERFACE_UNIT', `node interface ${u.name} has the words of a unit but no unit of them in php or python (HYR-3)`);
  }
}
