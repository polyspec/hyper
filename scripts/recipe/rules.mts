// Rules of protocol.md in the recipe check (HYR-2, HYR-6): the rules a concern or outside names, the sentences that
// a quote must equal, and the `only` of each unit, member, type, type field and case.
import { type Only, type Spec } from './types.mts';
import type { Ctx } from './context.mts';

/** The rules of protocol.md are its definition lines `- **HY-n** ...`; a mention of HY-n in prose defines no rule. */
export function rulesOf(protocol: string): Set<string> {
  return new Set(protocol.split('\n').flatMap((line) => line.match(/^\s*-\s*\*\*(HY-\d+)\*\*/u)?.[1] ?? []));
}

/** The text of one rule: its definition line and the indented lines under it, without the id. */
export function ruleText(protocol: string, rule: string): string | undefined {
  const lines = protocol.split('\n');
  const at = lines.findIndex((l) => l.match(/^\s*-\s*\*\*(HY-\d+)\*\*/u)?.[1] === rule);
  if (at < 0) return undefined;
  const parts = [(lines[at] ?? '').replace(/^\s*-\s*\*\*HY-\d+\*\*/u, '')];
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() === '' || /^\s*(?:-|#)/u.test(line)) break;
    parts.push(line.trim());
  }
  return parts.join(' ').replace(/\s+/gu, ' ').trim();
}

/**
 * HYR-6 sentences: a sentence ends at a period followed by a space or the end of the text, outside a code span.
 * A period inside an identifier (`session.save_handler`) or a number (`6.3.0`) does not end one.
 */
export function sentences(text: string): string[] {
  const out: string[] = [];
  let current = '';
  let code = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    current += ch;
    if (ch === '`') code = !code;
    else if (ch === '.' && !code && (i + 1 === text.length || /\s/u.test(text.charAt(i + 1)))) {
      out.push(current.trim());
      current = '';
    }
  }
  if (current.trim() !== '') out.push(current.trim());
  return out;
}

/** True when `quote` is one whole sentence of the text of `rule` (HYR-6). */
export function isSentenceOf(protocol: string, rule: string, quote: string): boolean {
  const text = ruleText(protocol, rule);
  return text !== undefined && sentences(text).includes(quote.trim());
}

/** HYR-2 and HYR-6: each rule the spec names exists, every rule is named once, and each `only` quotes its rule. */
export function checkRules(ctx: Ctx, onlys: Only[]): void {
  const { spec, protocol, add } = ctx;
  const rules = rulesOf(protocol);
  for (const r of [...spec.concerns.flatMap((c) => c.rules), ...spec.outside.map((o) => o.rule), ...onlys.map((o) => o.rule)]) {
    if (!rules.has(r)) add('RULE_UNKNOWN', `${r} is not a rule of protocol.md`);
  }
  const concernRules = new Set(spec.concerns.flatMap((c) => c.rules));
  for (const o of spec.outside) {
    if (o.reason.trim() === '') add('OUTSIDE_REASON', `outside ${o.rule} has an empty reason`);
    if (concernRules.has(o.rule)) add('OUTSIDE_CONCERN', `${o.rule} is named by a concern and by outside`);
  }
  for (const r of rules) {
    if (!concernRules.has(r) && !spec.outside.some((o) => o.rule === r)) add('RULE_UNCOVERED', `${r} is named by no concern and no outside entry`);
  }
  for (const o of onlys) {
    if (!isSentenceOf(protocol, o.rule, o.quote)) add('ONLY_QUOTE', `quote of ${o.rule} is not one whole sentence of it: ${o.quote}`);
  }
}

