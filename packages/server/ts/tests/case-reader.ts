// The reader of the case files of contracts/ (HYR-7, HY-130). It reads contracts/interfaces.json for the declaration of
// each field and outcome, checks that the case file holds nothing that the declaration does not state, and gives a step
// the cases of its section with the inputs that it reads and the comparisons that it makes. The steps of the Node server
// are the only users of this reader; the reader has no test of its own.
import { readFileSync } from 'node:fs';
import { parseJson } from '@polyspec/template/render';

type Compare = 'exact' | 'ordered' | 'subset' | 'absent' | 'contains' | 'excludes' | 'prefix' | 'keys' | 'raises';

interface Only {
  languages: string[];
}

interface Field {
  role: 'id' | 'label' | 'input' | 'expected';
  optional?: boolean;
  compare?: Compare;
  only?: Only;
  fields?: Record<string, Field>;
}

interface Outcome {
  compare: Compare;
  only?: Only;
}

interface Section {
  runners: string[];
  uses: string[];
  fields: Record<string, Field>;
  outcomes?: Record<string, Outcome>;
}

interface Declaration {
  rule: string;
  fixtures: Record<string, string>;
  sections: Record<string, Section>;
}

const LANGUAGE = 'node';
const CONTRACTS = new URL('../../../../contracts/', import.meta.url);

const applies = (declared: { only?: Only }): boolean => declared.only === undefined || declared.only.languages.includes(LANGUAGE);

// The entries of an object of the contract, which is a Map that keeps the order of its keys, or undefined for a value
// that is not an object.
function entriesOf(value: unknown): [string, unknown][] | undefined {
  if (value instanceof Map) return [...value.entries()].map(([key, item]) => [String(key), item]);
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return Object.entries(value);
  return undefined;
}

// The member of an object of the contract under a key, or undefined when the object has no such key.
function member(value: unknown, key: string): unknown {
  return (entriesOf(value) ?? []).find(([name]) => name === key)?.[1];
}

// Two values are equal when they hold equal items; maps and objects are unordered unless `ordered` is set.
function equal(a: unknown, b: unknown, ordered: boolean): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => equal(item, b[i], ordered));
  }
  const ea = entriesOf(a);
  const eb = entriesOf(b);
  if (ea !== undefined || eb !== undefined) {
    if (ea === undefined || eb === undefined || ea.length !== eb.length) return false;
    if (ordered) {
      return ea.every(([key, item], i) => {
        const other = eb[i];
        return other !== undefined && other[0] === key && equal(item, other[1], true);
      });
    }
    return ea.every(([key, item]) => equal(item, member(b, key), false) && eb.some(([name]) => name === key));
  }
  return a === b;
}

// The declarations of interfaces.json, read once.
let cached: { caseFiles: Record<string, Declaration> } | undefined;
function declarations(): { caseFiles: Record<string, Declaration> } {
  cached ??= JSON.parse(readFileSync(new URL('interfaces.json', CONTRACTS), 'utf8')) as { caseFiles: Record<string, Declaration> };
  return cached;
}

// The first key of a case file, or of one of its cases, that the declaration does not state, as the path of the key.
function undeclaredIn(contract: unknown, declaration: Declaration): string | undefined {
  for (const [key] of entriesOf(contract) ?? []) {
    if (!(key in declaration.sections) && !(key in declaration.fixtures)) return `$.${key}`;
  }
  for (const [name, section] of Object.entries(declaration.sections)) {
    const items = member(contract, name);
    if (!section.runners.includes(LANGUAGE) || !Array.isArray(items)) continue;
    for (const [index, item] of items.entries()) {
      const found = undeclaredFields(section.fields, item, `$.${name}[${index}]`);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function undeclaredFields(fields: Record<string, Field>, value: unknown, path: string): string | undefined {
  for (const [key, child] of entriesOf(value) ?? []) {
    const field = fields[key];
    if (field === undefined) return `${path}.${key}`;
    if (field.fields !== undefined) {
      const found = undeclaredFields(field.fields, child, `${path}.${key}`);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

export class CaseReader {
  private readonly read = new Set<string>();
  private readonly compared = new Set<string>();
  private readonly differs: string[] = [];
  private error: string | undefined;

  private readonly file: string;
  private readonly sectionName: string;
  private readonly item: unknown;
  private readonly section_: Section;
  private readonly contract: unknown;

  private constructor(file: string, sectionName: string, item: unknown, section_: Section, contract: unknown) {
    this.file = file;
    this.sectionName = sectionName;
    this.item = item;
    this.section_ = section_;
    this.contract = contract;
  }

  // Returns the names of the case files that the declaration of interfaces.json states.
  static files(): string[] {
    return Object.keys(declarations().caseFiles);
  }

  // Returns the readers of the cases of a case file that the Node server runs, in the order of the file. A file whose
  // keys the declaration does not state fails every case with FILE_UNDECLARED (HYR-7).
  static cases(file: string): CaseReader[] {
    const declaration = declarations().caseFiles[file];
    if (declaration === undefined) throw new Error(`interfaces.json declares no case file ${file}`);
    const contract = parseJson(readFileSync(new URL(file, CONTRACTS), 'utf8'));
    const undeclared = undeclaredIn(contract, declaration);
    const readers: CaseReader[] = [];
    for (const [name] of entriesOf(contract) ?? []) {
      const section = declaration.sections[name];
      const items = member(contract, name);
      if (section === undefined || !section.runners.includes(LANGUAGE) || !Array.isArray(items)) continue;
      for (const item of items) {
        const reader = new CaseReader(file, name, item, section, contract);
        if (undeclared !== undefined) reader.error = `FILE_UNDECLARED ${undeclared}`;
        readers.push(reader);
      }
    }
    return readers;
  }

  section(): string {
    return this.sectionName;
  }

  id(): string {
    return String(member(this.item, 'id'));
  }

  // Whether the case states a field, with dotted names for the fields of a nested field.
  has(name: string): boolean {
    return this.valueOf(name) !== undefined;
  }

  // Returns the input of the case, or the fixture of the file that the section uses; the input is read for `line`.
  input(name: string): unknown {
    this.read.add(name);
    if (this.section_.uses.includes(name)) return member(this.contract, name);
    const field = this.fieldOf(name);
    if (field.role !== 'input') throw new Error(`${name} of ${this.sectionName} is not an input`);
    return this.valueOf(name);
  }

  // Compares an observed value with the expected field of the case. An absent optional field compares nothing.
  compare(name: string, observed: unknown): void {
    const field = this.fieldOf(name);
    if (!applies(field)) return;
    const expected = this.valueOf(name);
    if (expected === undefined) {
      if (field.optional === true) return;
      throw new Error(`the case has no field ${name}`);
    }
    if (field.compare === undefined) throw new Error(`${name} of ${this.sectionName} has no comparison`);
    this.compared.add(name);
    this.read.add(name);
    if (!this.matches(field.compare, expected, observed)) this.differs.push(name);
  }

  // Compares an outcome of the section. A `raises` outcome holds when the observed call raised; any other outcome is
  // given as the pair of values that must be equal.
  outcome(name: string, observed: unknown): void {
    const declared = this.section_.outcomes?.[name];
    if (declared === undefined) throw new Error(`${this.sectionName} declares no outcome ${name}`);
    if (!applies(declared)) return;
    this.compared.add(name);
    let ok: boolean;
    if (declared.compare === 'raises') {
      ok = observed === true;
    } else {
      const [left, right] = observed as [unknown, unknown];
      ok = equal(left, right, false);
    }
    if (!ok) this.differs.push(name);
  }

  // Marks the case as failed with a reason that the runner states as CASE_ERROR.
  fail(reason: string): void {
    this.error = `CASE_ERROR ${reason.replace(/\s+/g, ' ').trim()}`;
  }

  failed(): boolean {
    return this.error !== undefined;
  }

  // Returns the result line of the case: its first failure in order of the checks (HY-130).
  line(): string {
    const reason = this.error ?? this.reasonOf();
    const head = `CASE ${this.file} ${this.id()}`;
    return reason === undefined ? `${head} PASS` : `${head} FAIL ${reason}`;
  }

  private reasonOf(): string | undefined {
    if (this.differs.length > 0) return `FIELD_DIFFERS ${this.differs[0]}`;
    const unknown = this.unreadIn(this.section_.fields, this.item, '', 'input', this.read);
    if (unknown !== undefined) return `FIELD_UNKNOWN ${unknown}`;
    const uncompared = this.unreadIn(this.section_.fields, this.item, '', 'expected', this.compared);
    if (uncompared !== undefined) return `FIELD_UNCOMPARED ${uncompared}`;
    const outcome = Object.entries(this.section_.outcomes ?? {}).find(([name, declared]) => applies(declared) && !this.compared.has(name));
    return outcome === undefined ? undefined : `FIELD_UNCOMPARED ${outcome[0]}`;
  }

  // The first present field of the given role that is not covered by the set of read or compared names.
  private unreadIn(fields: Record<string, Field>, value: unknown, prefix: string, role: 'input' | 'expected', seen: Set<string>): string | undefined {
    for (const [key, field] of Object.entries(fields)) {
      const child = member(value, key);
      if (!applies(field) || child === undefined) continue;
      const name = prefix + key;
      if (field.fields !== undefined && entriesOf(child) !== undefined) {
        const inner = this.unreadIn(field.fields, child, `${name}.`, role, seen);
        if (inner !== undefined) return inner;
        continue;
      }
      if (field.role !== role) continue;
      if (![...seen].some((covered) => name === covered || name.startsWith(`${covered}.`))) return name;
    }
    return undefined;
  }

  private fieldOf(name: string): Field {
    let fields: Record<string, Field> | undefined = this.section_.fields;
    let field: Field | undefined;
    for (const part of name.split('.')) {
      field = fields?.[part];
      if (field === undefined) throw new Error(`${this.sectionName} declares no field ${name}`);
      fields = field.fields;
    }
    return field as Field;
  }

  private valueOf(name: string): unknown {
    let value: unknown = this.item;
    for (const part of name.split('.')) {
      if (entriesOf(value) === undefined) return undefined;
      value = member(value, part);
    }
    return value;
  }

  private matches(kind: Compare, expected: unknown, observed: unknown): boolean {
    // The contains and excludes comparisons take one text or a list of texts.
    const texts = typeof expected === 'string' ? [expected] : (expected as string[]);
    // Header names are compared without regard to case.
    const headerOf = (name: string): unknown => (entriesOf(observed) ?? []).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
    switch (kind) {
      case 'exact':
        return equal(expected, observed, false);
      case 'ordered':
        return equal(expected, observed, true);
      case 'subset':
        return (entriesOf(expected) ?? []).every(([name, value]) => headerOf(name) === value);
      case 'absent':
        return (expected as string[]).every((name) => headerOf(name) === undefined);
      case 'contains':
        return typeof observed === 'string' && texts.every((text) => observed.includes(text));
      case 'excludes':
        return typeof observed === 'string' && texts.every((text) => !observed.includes(text));
      case 'prefix':
        return Array.isArray(observed) && equal(expected, observed.slice(0, (expected as unknown[]).length), true);
      case 'keys':
        return equal(expected, (entriesOf(observed) ?? []).map(([key]) => key), true);
      case 'raises':
        return expected === observed;
    }
  }
}
