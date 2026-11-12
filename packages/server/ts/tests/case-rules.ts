// The rules that CaseReader applies to one case of a case file (HYR-7, HYR-11): the declarations, the field lookups,
// the undeclared keys, the unread and uncompared fields, and the folding of header names.
import { readFileSync } from 'node:fs';
import { parseJson } from '@polyspec/template/render';

export type Compare = 'exact' | 'ordered' | 'subset' | 'absent' | 'contains' | 'excludes' | 'prefix' | 'keys' | 'raises';

interface Only {
  languages: string[];
}

interface Field {
  role: 'id' | 'label' | 'input' | 'expected' | 'response';
  optional?: boolean;
  compare?: Compare;
  sentence?: string;
  state?: string;
  only?: Only;
  fields?: Record<string, Field>;
}

interface Outcome {
  compare: Compare;
  sentence?: string;
  only?: Only;
}

export interface Section {
  runners: string[];
  uses: string[];
  fields: Record<string, Field>;
  outcomes?: Record<string, Outcome>;
}

export interface Declaration {
  fixtures: Record<string, string>;
  sections: Record<string, Section>;
}

export const CONTRACTS = new URL('../../../../contracts/', import.meta.url);

// The comparison of each response field, which is compared by its name (HYR-11).
const RESPONSE_KINDS: Record<string, Compare> = {
  status: 'exact',
  body: 'exact',
  headers: 'subset',
  allHeaders: 'exact',
  absentHeaders: 'absent',
  bodyContains: 'contains',
  bodyNotContains: 'excludes',
};

// The response fields whose names are header names, which compare without regard to ASCII case (HY-130).
const HEADER_FIELDS = new Set(['headers', 'allHeaders', 'absentHeaders']);

// The case keys that are not fields of a section (HYR-11 requirements, HYR-6 only).
const SKIPPED_KEYS = new Set(['only', 'requirements']);

// The text that stands for an integer literal outside ±(2^53 − 1) while a case file is parsed: a character of the
// private use area, which no case file holds, before the digits.
const LARGE = '\ue000integer:';

/** The value of a large integer literal after the parse, with every other value as it is. */
function restored(value: unknown): unknown {
  if (typeof value === 'string') return value.startsWith(LARGE) ? BigInt(value.slice(LARGE.length)) : value;
  if (Array.isArray(value)) return value.map(restored);
  if (value instanceof Map) return new Map([...value].map(([key, item]) => [key, restored(item)]));
  return value;
}

/**
 * The value of the JSON text of a case file: an object is a Map in document order, and an integer literal outside
 * ±(2^53 − 1), which a case gives a handler as its host value (HY-44), is a bigint.
 */
export function parsed(text: string): unknown {
  if (text.includes(LARGE)) throw new Error('a case file holds the text that stands for a large integer');
  // A string literal is copied as it is; a number literal outside a string that is a large integer becomes a string.
  const marked = text.replace(/"(?:[^"\\]|\\.)*"|-?[0-9]+(?![0-9.eE])/gu, (token) => (token.startsWith('"') || Number.isSafeInteger(Number(token)) ? token : `"${LARGE}${token}"`));
  return restored(parseJson(marked));
}

let cached: Record<string, Declaration> | undefined;

/** The `caseFiles` of contracts/interfaces.json, read once. */
export function caseFiles(): Record<string, Declaration> {
  cached ??= (JSON.parse(readFileSync(new URL('interfaces.json', CONTRACTS), 'utf8')) as { caseFiles: Record<string, Declaration> }).caseFiles;
  return cached;
}

/** Whether a field, an outcome or a case applies to the runner (HYR-6). */
export function visible(declared: { only?: Only }, runner: string): boolean {
  return declared.only === undefined || declared.only.languages.includes(runner);
}

/** The entries of a map or a plain object, or undefined for any other value. */
export function entriesOf(value: unknown): [string, unknown][] | undefined {
  if (value instanceof Map) return [...value.entries()].map(([key, item]) => [String(key), item]);
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return Object.entries(value);
  return undefined;
}

/** The member of a map or a plain object by its key. */
export function member(value: unknown, key: string): unknown {
  return (entriesOf(value) ?? []).find(([name]) => name === key)?.[1];
}

/** The value of a dotted name in a case, or undefined when the case does not hold it. */
export function lookup(item: unknown, name: string): unknown {
  let value = item;
  for (const part of name.split('.')) {
    if (entriesOf(value) === undefined) return undefined;
    value = member(value, part);
  }
  return value;
}

/** The declaration of a dotted field name; an undeclared name throws. */
export function field(fields: Record<string, Field>, name: string, section: string): Field {
  let current: Record<string, Field> | undefined = fields;
  let found: Field | undefined;
  for (const part of name.split('.')) {
    found = current !== undefined && Object.hasOwn(current, part) ? current[part] : undefined;
    if (found === undefined) throw new Error(`${section} declares no field ${name}`);
    current = found.fields;
  }
  if (found === undefined) throw new Error(`${section} declares no field ${name}`);
  return found;
}

/** The comparison of a field: a response field has the comparison of its name (HYR-11). */
export function kind(declared: Field, name: string, section: string): Compare {
  const compare = declared.role === 'response' ? RESPONSE_KINDS[name] : declared.compare;
  if (compare === undefined) throw new Error(`${name} of ${section} has no comparison`);
  return compare;
}

/** The names of a header map, or of a list of header names, in ASCII lower case, for a header field; other values as given. */
export function folded(name: string, value: unknown): unknown {
  if (!HEADER_FIELDS.has(name)) return value;
  const asciiLower = (text: string): string => text.replace(/[A-Z]+/g, (part) => part.toLowerCase());
  if (Array.isArray(value)) return value.map((item: unknown): unknown => (typeof item === 'string' ? asciiLower(item) : item));
  const entries = entriesOf(value);
  if (entries === undefined) return value;
  return Object.fromEntries(entries.map(([key, item]): [string, unknown] => [asciiLower(key), item]));
}

/** The first expected field without fields that has no comparison or no sentence, as its path in the declaration. */
function undeclaredDeclaration(fields: Record<string, Field>, path: string, runner: string): string | undefined {
  for (const [key, declared] of Object.entries(fields)) {
    if (!visible(declared, runner)) continue;
    if (declared.fields !== undefined) {
      const found = undeclaredDeclaration(declared.fields, `${path}.${key}`, runner);
      if (found !== undefined) return found;
    } else if (declared.role === 'expected' && (declared.compare === undefined || declared.sentence === undefined)) {
      return `${path}.${key}`;
    }
  }
  return undefined;
}

/** The first key of a case that the declared fields do not state, as its path in the case file. */
function undeclaredFields(fields: Record<string, Field>, value: unknown, path: string): string | undefined {
  for (const [key, child] of entriesOf(value) ?? []) {
    if (SKIPPED_KEYS.has(key)) continue;
    const declared = Object.hasOwn(fields, key) ? fields[key] : undefined;
    if (declared === undefined) return `${path}.${key}`;
    if (declared.fields !== undefined) {
      const found = undeclaredFields(declared.fields, child, `${path}.${key}`);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** The first key of a case file, or of one of its cases, that the declaration does not state, as the path of the key. */
export function undeclared(declaration: Declaration, contract: unknown, runner: string): string | undefined {
  for (const [key] of entriesOf(contract) ?? []) {
    if (SKIPPED_KEYS.has(key)) continue;
    if (!Object.hasOwn(declaration.sections, key) && !Object.hasOwn(declaration.fixtures, key)) return `$.${key}`;
  }
  for (const [name, section] of Object.entries(declaration.sections)) {
    const items = member(contract, name);
    if (!section.runners.includes(runner) || !Array.isArray(items)) continue;
    const declared = undeclaredDeclaration(section.fields, `$.${name}`, runner);
    if (declared !== undefined) return declared;
    for (const [index, item] of items.entries()) {
      const found = undeclaredFields(section.fields, item, `$.${name}[${index}]`);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** The first present field of the given roles, by dotted name, that the set of read or compared names does not cover. */
export function uncovered(fields: Record<string, Field>, item: unknown, prefix: string, roles: string[], seen: Set<string>, runner: string): string | undefined {
  for (const [key, declared] of Object.entries(fields)) {
    const child = member(item, key);
    if (!visible(declared, runner) || child === undefined) continue;
    const name = prefix + key;
    if (declared.fields !== undefined && entriesOf(child) !== undefined) {
      const inner = uncovered(declared.fields, child, `${name}.`, roles, seen, runner);
      if (inner !== undefined) return inner;
      continue;
    }
    if (!roles.includes(declared.role)) continue;
    if (![...seen].some((covered) => name === covered || name.startsWith(`${covered}.`))) return name;
  }
  return undefined;
}
