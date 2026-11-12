// The recipe check (HYR-1 to HYR-9): compares the development spec with the readers' output, the protocol and the case
// files. Each check module adds its findings through the context; this module runs them in order.

import type { Protocol } from './protocol.mts';
import { type Lang, type Finding, type Only, type Sources, type Spec } from './types.mts';
import type { Ctx } from './context.mts';
import { checkRules } from './rules.mts';
import { caseOnlys, checkCases } from './cases.mts';
import { checkTests } from './tests.mts';
import { checkUnits } from './units.mts';
import { checkMembers } from './members.mts';
import { checkShapes } from './shapes.mts';
import { checkBarrels } from './barrels.mts';
import { checkStated, type Counts } from './stated.mts';

export function compare(
  spec: Spec,
  sources: Record<Lang, Sources>,
  root: string,
  protocol: Protocol,
  readDir: Ctx['readDir'],
  counts?: Counts,
): Finding[] {
  const out: Finding[] = [];
  const ctx: Ctx = { spec, root, protocol, sources, readDir, add: (code, message) => out.push({ code, message }) };
  const units = spec.concerns.flatMap((c) => c.units);
  const onlys: Only[] = [];
  for (const u of units) {
    if (u.only) onlys.push(u.only);
    for (const m of u.members) if (m.only) onlys.push(m.only);
  }
  for (const t of spec.types) {
    if (t.only) onlys.push(t.only);
    for (const f of Object.values(t.shape.fields ?? {})) if (typeof f !== 'string' && f.only) onlys.push(f.only);
  }
  onlys.push(...caseOnlys(spec, root));

  checkRules(ctx, onlys);
  checkCases(ctx);
  checkTests(ctx);
  checkUnits(ctx);
  checkMembers(ctx);
  checkShapes(ctx);
  checkBarrels(ctx);
  const stated = checkStated(ctx);
  if (counts !== undefined) Object.assign(counts, stated);
  return out;
}
