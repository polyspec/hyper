// The rules that CaseReader applies to one case of a case file (HYR-7, HYR-11): the declarations, the field lookups,
// the undeclared keys, the unread and uncompared fields, and the folding of header names.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type * as Json from '@polyspec/json';

type JsonValue = Json.Value;

// The JSON reader of json, loaded with the require of Node, as the binding of the template package loads it: the addon
// registers its classes once in a process, so that a second instance of its entry, which an import that the test
// runner transforms would make, fails.
const required: (name: '@polyspec/json') => typeof Json = createRequire(import.meta.url);
const json = required('@polyspec/json');

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
  // The library of config/release-files.json whose release publishes the file (H35.11).
  release?: string;
  fixtures: Record<string, string>;
  sections: Record<string, Section>;
}

const CONTRACTS = new URL('../../../contracts/', import.meta.url);
// The fixed case files of tests/legacy, which a library holds now; the steps read them until S-4 removes the directory.
const LEGACY = new URL('../../../tests/legacy/', import.meta.url);
// The checkout, whose config/release-files.json pins the release files and whose var/release-files holds them.
const ROOT = new URL('../../../', import.meta.url);

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

/** The string of a JSON string value: its UTF-16 code units, an unpaired surrogate included. */
function stringOf(value: JsonValue): string {
  const text = value.stringText();
  if (text !== null) return text;
  let units = '';
  for (const unit of value.stringUnits()) units += String.fromCharCode(unit);
  return units;
}

/** The number of a JSON number literal: a bigint for an integer literal outside ±(2^53 − 1), a number for every other. */
function numberOf(literal: string): number | bigint {
  return /^-?[0-9]+$/u.test(literal) && !Number.isSafeInteger(Number(literal)) ? BigInt(literal) : Number(literal);
}

/** The host value of a value of the JSON reader. */
function hostValue(value: JsonValue): unknown {
  switch (value.kind) {
    case 'null': return null;
    case 'boolean': return value.booleanValue();
    case 'number': return numberOf(value.numberLiteral());
    case 'string': return stringOf(value);
    case 'array': return value.items().map(hostValue);
    case 'object': {
      const map = new Map<string, unknown>();
      for (const [key, item] of value.members()) map.set(stringOf(key), hostValue(item));
      return map;
    }
  }
}

/**
 * The value of the JSON text of a case file: an object is a Map in document order, and an integer literal outside
 * ±(2^53 − 1), which a case gives a handler as its host value (HY-44), is a bigint. The text is read as JSON, with the
 * reader of json and its limit of 256 nested containers, and not as a value of the template data model: a case states
 * a value outside the data model, such as a map of 64 levels (HY-44.11), which the server under test refuses, not the
 * reader. JSON.parse does not read it, because it moves the keys of an object that are integers before its other keys.
 */
export function parsed(text: string): unknown {
  return hostValue(json.parse(text));
}

let cached: Record<string, Declaration> | undefined;

/** Whether a value is an object that is no list. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether a value is the declarations of the case files: an object whose entries are objects with fixtures and sections. */
function isDeclarations(value: unknown): value is Record<string, Declaration> {
  return isObject(value) && Object.values(value).every((entry) => isObject(entry) && isObject(entry.fixtures) && isObject(entry.sections));
}

/** The `caseFiles` of contracts/interfaces.json, read once. */
export function caseFiles(): Record<string, Declaration> {
  if (cached !== undefined) return cached;
  const document: unknown = JSON.parse(readFileSync(new URL('interfaces.json', CONTRACTS), 'utf8'));
  const declarations: unknown = isObject(document) ? document.caseFiles : undefined;
  if (!isDeclarations(declarations)) throw new Error('interfaces.json holds no caseFiles');
  const legacy = legacyCaseFiles();
  cached = { ...declarations, ...legacy };
  return cached;
}

/** The `caseFiles` of tests/legacy/interfaces.json, or none when the directory is gone. */
function legacyCaseFiles(): Record<string, Declaration> {
  const file = new URL('interfaces.json', LEGACY);
  if (!existsSync(file)) return {};
  const document: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const declarations: unknown = isObject(document) ? document.caseFiles : undefined;
  if (!isDeclarations(declarations)) throw new Error('tests/legacy/interfaces.json holds no caseFiles');
  return declarations;
}

/**
 * The URL of a case file: under tests/legacy for a fixed case file, var/release-files/<library>/<tag>/contracts/<file>
 * for a file that the release of another library publishes (`release` of its declaration, H35.11), under contracts/
 * for every other one. A release file that is missing fails with its path and the target that writes it, and nothing
 * is downloaded (HR-85).
 */
export function caseFileUrl(file: string): URL {
  if (Object.hasOwn(legacyCaseFiles(), file)) return new URL(file, LEGACY);
  const library = caseFiles()[file]?.release;
  if (library === undefined) return new URL(file, CONTRACTS);
  const pins: unknown = JSON.parse(readFileSync(new URL('config/release-files.json', ROOT), 'utf8'));
  const release = isObject(pins) && isObject(pins.releases) ? pins.releases[library] : undefined;
  if (!isObject(release) || typeof release.tag !== 'string') throw new Error(`config/release-files.json pins no release of ${library}, which contracts/interfaces.json names for ${file}`);
  const name = `var/release-files/${library}/${release.tag}/contracts/${file}`;
  const url = new URL(name, ROOT);
  if (!existsSync(url)) throw new Error(`${name} is missing; \`make hyper-install-release-files\` writes it`);
  return url;
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

/**
 * The observed failure of a field `raises` without its message when the case states none: a case compares only a
 * message that a rule states (HY-132.4). Any other field as observed.
 */
export function statedMessage(name: string, expected: unknown, observed: unknown): unknown {
  if (name !== 'raises' || member(expected, 'message') !== null || entriesOf(observed) === undefined) return observed;
  return Object.fromEntries((entriesOf(observed) ?? []).map(([key, item]): [string, unknown] => [key, key === 'message' ? null : item]));
}

/** A failure of HY-132 as a field `raises` states it. */
export interface Raises {
  kind: unknown;
  status: unknown;
  category: string;
  message: string;
}

/**
 * The failure of HY-132 that an error gives: its kind, its status, the category that the first class
 * `Hyper<Category>Error` of its classes names (HY-132.2), and its message. A thrown value that is no Error, or
 * an Error without such a class, is no error of hyper but an error of the step, which is thrown again so that it fails
 * the case.
 */
export function raisesOf(error: unknown): Raises {
  if (!(error instanceof Error)) throw error;
  let category: string | null = null;
  for (let type: unknown = Object.getPrototypeOf(error); category === null && typeof type === 'object' && type !== null; type = Object.getPrototypeOf(type)) {
    const name: unknown = (type as { constructor?: { name?: unknown } }).constructor?.name;
    const match = typeof name === 'string' ? /^Hyper([A-Z][a-z]+)Error$/u.exec(name) : null;
    if (match !== null) category = (match[1] ?? '').toLowerCase();
  }
  if (category === null) throw error;
  const { kind, status } = error as Error & { kind?: unknown; status?: unknown };
  return { kind: kind ?? null, status: status ?? null, category, message: error.message };
}

/**
 * HYR-11: the error that a step raises is the open error when it is the hyper class of the category `value` with the
 * kind `invalid_application` (HY-106.21). An error that is no error of hyper is thrown again by `raisesOf`.
 */
export function openError(observed: unknown): boolean {
  if (observed === null || observed === undefined) return false;
  const raises = raisesOf(observed);
  return raises.category === 'value' && raises.kind === 'invalid_application';
}

/**
 * HYR-11: whether a step raised the error that a `raises` outcome expects, by the statement that the outcome cites. A
 * statement to which the kind tables of HY-132 give kinds, such as HY-106.21 with `invalid_application` and
 * `invalid_build` or HY-42.7 with `invalid_text`, accepts an error of one of them (`statedKinds`); the creation of a server fails with an error
 * of hyper whose kind HY-97.7 does not state, so that only its class is checked until H35.29-6; a statement that the
 * tables do not name is an open failure and expects the open error (HY-106.21).
 */
export function outcomeError(sentence: unknown, observed: unknown): boolean {
  const kinds = typeof sentence === 'string' ? statedKinds(sentence) : [];
  if (kinds.length === 0 && sentence !== 'HY-97.7') return openError(observed);
  if (observed === null || observed === undefined) return false;
  const raises = raisesOf(observed);
  return sentence === 'HY-97.7' || (typeof raises.kind === 'string' && kinds.includes(raises.kind));
}

let kindTable: Map<string, string[]> | undefined;

/** The rule of contracts/protocol.json with an id under a value, or undefined. */
function ruleOf(value: unknown, id: string): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = ruleOf(child, id);
      if (found !== undefined) return found;
    }
  } else if (isObject(value)) {
    if (value.kind === 'rule' && value.id === id) return value;
    for (const child of Object.values(value)) {
      const found = ruleOf(child, id);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** The English text of a cell of a table of contracts/protocol.json. */
function cellText(cell: unknown): string {
  if (!isObject(cell) || typeof cell.en !== 'string') throw new Error(`a cell of the kind tables of HY-132 has no English text: ${JSON.stringify(cell)}`);
  return cell.en;
}

/**
 * The kinds that each statement states, by its id, from the kind tables of HY-132 (HY-132.3, HY-132.9): the first cell
 * of a row is the kind in backticks, and its last cell the ids of the statements that state it, separated by ", ".
 */
function kindsByStatement(): Map<string, string[]> {
  const rule = ruleOf(JSON.parse(readFileSync(new URL('protocol.json', CONTRACTS), 'utf8')), 'HY-132');
  const blocks: unknown[] = Array.isArray(rule?.blocks) ? rule.blocks : [];
  const tables = blocks.filter((block): block is Record<string, unknown> => isObject(block) && block.kind === 'table');
  if (tables.length === 0) throw new Error('contracts/protocol.json holds no kind table of HY-132');
  const table = new Map<string, string[]>();
  for (const block of tables) {
    for (const row of Array.isArray(block.rows) ? block.rows : []) {
      if (!Array.isArray(row) || row.length < 2) throw new Error(`a row of the kind tables of HY-132 has no kind and rule: ${JSON.stringify(row)}`);
      const kind = cellText(row[0]).replaceAll('`', '');
      for (const id of cellText(row.at(-1)).split(', ')) table.set(id, [...(table.get(id) ?? []), kind]);
    }
  }
  return table;
}

/** The kinds that the kind tables of HY-132 give to a statement, in their order; none for a statement they do not name. */
function statedKinds(sentence: string): string[] {
  kindTable ??= kindsByStatement();
  return kindTable.get(sentence) ?? [];
}

/** The result of a call, or null and the failure of hyper with which it fails; any other error is thrown again. */
export function failureOf<T>(call: () => T): { result: T | null; raises: Raises | null } {
  try {
    return { result: call(), raises: null };
  } catch (error) {
    return { result: null, raises: raisesOf(error) };
  }
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
