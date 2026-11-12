// Rules and statements of contracts/protocol.json in the recipe check (HYR-2, HYR-6): the rules a concern or outside
// names, the statements an `only` or a case names, and the concern or outside entry that covers each rule.
import type { Only, Spec } from './types.mts';
import type { Ctx } from './context.mts';

/** The rule of a statement id: `HY-2.1` belongs to `HY-2`. */
export function ruleOf(sentence: string): string {
  return sentence.slice(0, sentence.lastIndexOf('.'));
}

/** HYR-2: a rule the spec names is a live rule of protocol.json; a retired one is named as retired. */
export function checkRuleId(ctx: Ctx, where: string, rule: string): void {
  const { protocol, add } = ctx;
  if (protocol.retiredRules.has(rule)) add('RULE_RETIRED', `${where} names ${rule}, which protocol.json retires`);
  else if (!protocol.rules.has(rule)) add('RULE_UNKNOWN', `${where} names ${rule}, which is not a rule of protocol.json`);
}

/**
 * HYR-6: a statement the spec names is a live statement of a live rule; returns its rule when it is one. A fixed copy of
 * the S-3b case changes (`fixed`) states the rule as it was before those changes, so its statement may be retired.
 */
export function checkStatement(ctx: Ctx, where: string, sentence: string, fixed = false): string | undefined {
  const { protocol, add } = ctx;
  const rule = ruleOf(sentence);
  if (protocol.retiredRules.has(rule)) {
    add('RULE_RETIRED', `${where} names ${rule}, which protocol.json retires`);
    return undefined;
  }
  const entry = protocol.rules.get(rule);
  if (entry === undefined) {
    add('RULE_UNKNOWN', `${where} names ${rule}, which is not a rule of protocol.json`);
    return undefined;
  }
  if (entry.retired.has(Number(sentence.slice(sentence.lastIndexOf('.') + 1)))) {
    if (fixed) return rule;
    add('SENTENCE_RETIRED', `${where} names ${sentence}, a statement that protocol.json retires`);
    return undefined;
  }
  if (!entry.statements.has(sentence)) {
    add('SENTENCE_UNKNOWN', `${where} names ${sentence}, which is not a statement of protocol.json`);
    return undefined;
  }
  return rule;
}

/** HYR-2 and HYR-6: each rule the spec names is live, each live rule is covered once, and each `only` names a statement. */
export function checkRules(ctx: Ctx, onlys: Only[]): void {
  const { spec, protocol, add } = ctx;
  for (const c of spec.concerns) for (const r of c.rules) checkRuleId(ctx, `concern ${c.id}`, r);
  for (const o of spec.outside) checkRuleId(ctx, `outside ${o.rule}`, o.rule);
  const concernRules = new Set(spec.concerns.flatMap((c) => c.rules));
  const outsideRules = new Set(spec.outside.map((o) => o.rule));
  for (const o of spec.outside) {
    if (o.reason.trim() === '') add('OUTSIDE_REASON', `outside ${o.rule} has an empty reason`);
    if (concernRules.has(o.rule)) add('OUTSIDE_CONCERN', `${o.rule} is named by a concern and by outside`);
  }
  for (const r of protocol.rules.keys()) {
    if (!concernRules.has(r) && !outsideRules.has(r)) add('RULE_UNCOVERED', `${r} is named by no concern and no outside entry`);
  }
  for (const o of onlys) {
    const rule = checkStatement(ctx, `an only of ${o.sentence}`, o.sentence, o.fixed === true);
    if (rule !== undefined && outsideRules.has(rule)) add('SENTENCE_OUTSIDE', `${o.sentence} is a statement of ${rule}, which is outside the spec`);
  }
}

/** The rules a concern names, for the case file that lists the concern in its cases. */
export function rulesOfFile(spec: Spec, file: string): Set<string> {
  return new Set(spec.concerns.filter((c) => Array.isArray(c.cases) && c.cases.includes(file)).flatMap((c) => c.rules));
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
