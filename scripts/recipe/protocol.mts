// The protocol of contracts/protocol.json as the recipe check reads it (HYR-2, HYR-5, HYR-6): its rules with their
// statements and retired statement numbers, the retired rules, the terms of its vocabulary and its statuses.

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

export type ProtocolRule = { statements: Set<string>; retired: Set<number> };

export type Protocol = {
  rules: Map<string, ProtocolRule>;
  retiredRules: Set<string>;
  terms: Set<string>;
  statuses: string;
};

/** Reads the rules, statements, terms and statuses of protocol.json; a statement belongs to the rule of its id. */
export function readProtocol(text: string): Protocol {
  const doc: unknown = JSON.parse(text);
  const rules = new Map<string, ProtocolRule>();
  const statements: string[] = [];
  const terms = new Set<string>();
  const statuses: string[] = [];
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
      return;
    }
    if (!isObject(v)) return;
    if (v.kind === 'rule' && typeof v.id === 'string') {
      const retired = Array.isArray(v.retired) ? v.retired.filter((n): n is number => typeof n === 'number') : [];
      rules.set(v.id, { statements: new Set(), retired: new Set(retired) });
    }
    if (typeof v.id === 'string' && /^HY-\d+\.\d+$/u.test(v.id)) statements.push(v.id);
    if (typeof v.term === 'string') terms.add(v.term);
    if (typeof v.en === 'string') statuses.push(v.en);
    for (const x of Object.values(v)) visit(x);
  };
  visit(doc);
  for (const id of statements) rules.get(id.slice(0, id.lastIndexOf('.')))?.statements.add(id);
  const retiredRules = new Set<string>(isObject(doc) && Array.isArray(doc.retiredRules) ? doc.retiredRules.map(String) : []);
  return { rules, retiredRules, terms, statuses: statuses.join('\n') };
}
