// Barrels of the recipe check (HYR-2): the re-exports of a barrel are the public units and public types of the spec.

import { LANGS } from './types.mts';
import type { Ctx } from './context.mts';
import { symbolName, words } from './names.mts';

export function checkBarrels(ctx: Ctx): void {
  const { spec, sources, add } = ctx;
  const units = spec.concerns.flatMap((c) => c.units);
  for (const lang of LANGS) {
    const barrels = spec.languages[lang].barrel;
    if (barrels.length === 0) continue;
    const exported = new Set(sources[lang].exports.filter((e) => barrels.includes(e.file)).map((e) => e.name));
    const expected = new Set<string>();
    for (const u of units) {
      const n = u.native[lang];
      if (!n || n.internal) continue;
      const r = sources[lang].units.find((x) => x.file === n.file && words(x.name) === u.id);
      if (!r) {
        // A public unit whose file declares no class of its name has no export to expect; it is a finding, not a skip.
        add('UNIT_CLASS_MISSING', `${lang} unit ${u.id} is public, and ${n.file} declares no class of its name, so the barrel check cannot name its export`);
        continue;
      }
      if (r.kind === 'functions') {
        // A file of functions exports its public functions, not the file's stem (HYR-2).
        for (const m of u.members) if (m.visibility === 'public' && m.native[lang]) expected.add(symbolName(m.native[lang].symbol));
      } else expected.add(r.name);
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
}
