// Writes the cases of contracts/ that the generated tests of every binding run (HR-100): each section that
// config/binding-cases.json names becomes the group of the same name in var/binding-cases/<source>, in the form of a
// binding case (binding K-1, CK-22): `id`, `rule` when the case names its requirements, one key for each parameter of
// the member, and `result`, or `raises` with the kind. packages/rust/interface.json names each group in a row of cases.
//   node scripts/binding-cases.mts --config config/binding-cases.json --contracts contracts --output var/binding-cases
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { writeFileAtomic } from '../packages/cli/lib/output-files.mjs';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Argument = { field: string; as?: 'bytes' } | { call: string };
export interface Section {
  source: string;
  group: string;
  member: string;
  args: Record<string, Argument>;
  result: string;
  skip?: string[];
}

// The kinds that a binding decides before the core runs (binding G-5): their cases are the binding's own.
const BINDING_KINDS = new Set(['invalid_argument_type', 'invalid_number', 'invalid_text']);

// The targets of a case whose `only` names languages of the servers: Node is also WASM, whose numbers are those of
// JavaScript, and Go, whose numbers no language of the servers states, takes no such case.
const TARGETS: Record<string, string[]> = { node: ['node', 'wasm'], php: ['php'], python: ['python'] };

// A JSON text read as a value: JSON.parse gives a JSON value, whose type the checker cannot see.
function parse(text: string): Json {
  const value: unknown = JSON.parse(text);
  return value as Json; // oxlint-disable-line typescript/no-unsafe-type-assertion -- JSON.parse gives only JSON values
}

const isObject = (value: Json | undefined): value is { [key: string]: Json } => typeof value === 'object' && value !== null && !Array.isArray(value);

// The argument of the one call of a case named `name`, a JSON text in the case, or undefined when the case has no such
// single call.
function callArgument(kase: { [key: string]: Json }, name: string): Json | undefined {
  const calls = kase['calls'];
  if (!Array.isArray(calls) || calls.length !== 1) return undefined;
  const [call] = calls;
  if (!Array.isArray(call) || call[0] !== name || !Array.isArray(call[1]) || call[1].length !== 1) return undefined;
  const [text] = call[1];
  if (typeof text !== 'string') return undefined;
  // A float of the call has no form in a JSON value that every reader keeps apart from an integer, and an integer
  // outside the safe range is outside the type int of the contract, which the binding refuses before the core runs
  // (binding T-1, CK-64): both are left out.
  const value = parse(text);
  if (typeof value !== 'number') return value;
  if (!/^-?\d+$/u.test(text) || text === '-0') return undefined;
  return Number.isSafeInteger(value) ? value : undefined;
}

// The value of an argument of a case, or undefined when the case cannot give it.
function argument(kase: { [key: string]: Json }, spec: Argument): Json | undefined {
  if ('call' in spec) return callArgument(kase, spec.call);
  if (spec.as === 'bytes') {
    const hex = kase['bytes'];
    if (typeof hex === 'string') return { hex };
    const text = kase[spec.field];
    return typeof text === 'string' ? { hex: Buffer.from(text, 'utf8').toString('hex') } : undefined;
  }
  return kase[spec.field];
}

// The binding case of a contract case, or undefined for a case that the section leaves out.
function bindingCase(section: Section, kase: Json): Json | undefined {
  if (!isObject(kase) || typeof kase['id'] !== 'string') throw new Error(`${section.source}:${section.group}: a case without an id`);
  if ((section.skip ?? []).some((field) => kase[field] === true)) return undefined;
  const raises = kase['raises'];
  if (isObject(raises) && typeof raises['kind'] === 'string' && BINDING_KINDS.has(raises['kind'])) return undefined;
  const out: { [key: string]: Json } = { id: kase['id'] };
  const requirements = kase['requirements'];
  if (Array.isArray(requirements) && typeof requirements[0] === 'string') out['rule'] = requirements[0];
  for (const [name, spec] of Object.entries(section.args)) {
    const value = argument(kase, spec);
    if (value === undefined) return undefined;
    out[name] = value;
  }
  if (isObject(raises) && typeof raises['kind'] === 'string') out['raises'] = { kind: raises['kind'] };
  else out['result'] = kase[section.result] ?? null;
  return out;
}

// A group of var/binding-cases and the row of interface.json that names it, with the targets of its `only`.
export interface Row {
  member: string;
  file: string;
  group: string;
  only?: { targets: string[]; reason: string };
}

// The targets of a case, or undefined for a case of every target.
function targetsOf(kase: Json): string[] | undefined {
  if (!isObject(kase) || !isObject(kase['only'])) return undefined;
  const languages = kase['only']['languages'];
  if (!Array.isArray(languages)) throw new Error(`the case ${JSON.stringify(kase['id'])} has an only without languages`);
  return [...new Set(languages.flatMap((language) => (typeof language === 'string' ? TARGETS[language] : undefined) ?? []))].sort();
}

// The files of var/binding-cases, each source file with its groups, and the rows of cases that name them: a section
// whose cases name `only` gives one group for its other cases and one for each set of targets.
export function bindingCases(sections: Section[], read: (source: string) => Json): { files: Map<string, { [key: string]: Json }>; rows: Row[] } {
  const files = new Map<string, { [key: string]: Json }>();
  const rows: Row[] = [];
  for (const section of sections) {
    const contract = read(section.source);
    const cases = isObject(contract) ? contract[section.group] : undefined;
    if (!Array.isArray(cases)) throw new Error(`${section.source} has no section ${section.group}`);
    const groups = new Map<string, { only?: string[]; reason?: string; cases: Json[] }>();
    for (const kase of cases) {
      const out = bindingCase(section, kase);
      if (out === undefined) continue;
      const only = targetsOf(kase);
      const name = only === undefined ? section.group : `${section.group}_only_${only.join('_')}`;
      const reason = isObject(kase) && isObject(kase['only']) && typeof kase['only']['sentence'] === 'string' ? kase['only']['sentence'] : '';
      const group = groups.get(name) ?? (only === undefined ? { cases: [] } : { only, reason, cases: [] });
      group.cases.push(out);
      groups.set(name, group);
    }
    if (groups.size === 0) throw new Error(`${section.source}:${section.group} gives no binding case`);
    const file = files.get(section.source) ?? { comment: `Generated by scripts/binding-cases.mts from contracts/${section.source}; do not edit, and do not track it.` };
    for (const [name, group] of groups) {
      if (name in file) throw new Error(`${section.source}:${name} is named twice`);
      file[name] = group.cases;
      const row: Row = { member: section.member, file: `var/binding-cases/${section.source}`, group: name };
      if (group.only !== undefined) row.only = { targets: group.only, reason: group.reason ?? '' };
      rows.push(row);
    }
    files.set(section.source, file);
  }
  return { files, rows };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { config: { type: 'string' }, contracts: { type: 'string' }, output: { type: 'string' } }, strict: true });
  if (values.config === undefined || values.contracts === undefined || values.output === undefined) {
    throw new Error('usage: binding-cases.mts --config <config/binding-cases.json> --contracts <contracts> --output <var/binding-cases>');
  }
  const contracts = values.contracts;
  const config = parse(readFileSync(values.config, 'utf8'));
  if (!isObject(config) || !Array.isArray(config['sections'])) throw new Error(`${values.config} has no sections`);
  const sections = config['sections'] as unknown as Section[]; // oxlint-disable-line typescript/no-unsafe-type-assertion -- the file is tracked and its sections are checked by bindingCases
  const { files, rows } = bindingCases(sections, (source) => parse(readFileSync(join(contracts, source), 'utf8')));
  for (const [source, file] of files) writeFileAtomic(join(values.output, source), `${JSON.stringify(file, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(rows)}\n`);
}
