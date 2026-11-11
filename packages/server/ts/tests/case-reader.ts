// The reader of the case files of contracts/ (HYR-7, HYR-11). It reads contracts/interfaces.json for the declaration of
// each field and outcome, checks that the case file holds nothing that the declaration does not state, and gives a step
// the cases of its section with the inputs that it reads and the comparisons that it makes. The steps of the Node server
// and the browser and build runners read their cases through this reader; the reader has no test of its own.
import { readFileSync } from 'node:fs';
import { parseJson } from '@polyspec/template/render';

type Compare = 'exact' | 'ordered' | 'subset' | 'absent' | 'contains' | 'excludes' | 'prefix' | 'keys' | 'raises';

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

interface Section {
  runners: string[];
  uses: string[];
  fields: Record<string, Field>;
  outcomes?: Record<string, Outcome>;
}

interface Declaration {
  fixtures: Record<string, string>;
  sections: Record<string, Section>;
}

export class CaseReader {
  private static readonly CONTRACTS = new URL('../../../../contracts/', import.meta.url);

  // The comparison of each response field, which is compared by its name (HYR-11).
  private static readonly RESPONSE_COMPARE: Record<string, Compare> = {
    status: 'exact',
    body: 'exact',
    headers: 'subset',
    allHeaders: 'exact',
    absentHeaders: 'absent',
    bodyContains: 'contains',
    bodyNotContains: 'excludes',
  };

  // The response fields whose names are header names, which compare without regard to ASCII case (HY-130).
  private static readonly HEADER_FIELDS = new Set(['headers', 'allHeaders', 'absentHeaders']);

  // The case keys that the reader skips (HYR-11 requirements, HYR-6 only).
  private static readonly SKIPPED_KEYS = new Set(['only', 'requirements']);

  // The case files of interfaces.json, read once.
  private static cached: Record<string, Declaration> | undefined;

  private readonly read = new Set<string>();
  private readonly compared = new Set<string>();
  private readonly differs: string[] = [];
  private error: string | undefined;

  private readonly runner: string;
  private readonly file: string;
  private readonly sectionName: string;
  private readonly item: unknown;
  private readonly section_: Section;
  private readonly contract: unknown;
  private readonly undeclared: string | undefined;

  private constructor(runner: string, file: string, sectionName: string, item: unknown, section_: Section, contract: unknown, undeclared: string | undefined) {
    this.runner = runner;
    this.file = file;
    this.sectionName = sectionName;
    this.item = item;
    this.section_ = section_;
    this.contract = contract;
    this.undeclared = undeclared;
  }

  // Returns the readers of the cases that the runner of the given language runs, over every case file of the declaration,
  // in the order of each file. A file whose keys the declaration does not state fails every case with FILE_UNDECLARED.
  static cases(runner: string): CaseReader[] {
    const readers: CaseReader[] = [];
    for (const [file, declaration] of Object.entries(CaseReader.declaration())) {
      const contract = parseJson(readFileSync(new URL(file, CaseReader.CONTRACTS), 'utf8'));
      const undeclared = CaseReader.undeclaredIn(contract, declaration, runner);
      for (const [name] of CaseReader.entriesOf(contract) ?? []) {
        const section = Object.hasOwn(declaration.sections, name) ? declaration.sections[name] : undefined;
        const items = CaseReader.member(contract, name);
        if (section === undefined || !section.runners.includes(runner) || !Array.isArray(items)) continue;
        for (const item of items) readers.push(new CaseReader(runner, file, name, item, section, contract, undeclared));
      }
    }
    return readers;
  }

  section(): string {
    return `${this.file}:${this.sectionName}`;
  }

  id(): string {
    return String(CaseReader.member(this.item, 'id'));
  }

  // Whether the case states a field, with dotted names for the fields of a nested field.
  has(name: string): boolean {
    return CaseReader.valueOf(this.item, name) !== undefined;
  }

  // Returns the input of the case, or the fixture of the file that the section uses; the input is read for `line`.
  input(name: string): unknown {
    this.read.add(name);
    if (this.section_.uses.includes(name)) return CaseReader.member(this.contract, name);
    const field = CaseReader.fieldOf(this.section_, this.sectionName, name);
    if (field.role !== 'input') throw new Error(`${name} of ${this.sectionName} is not an input`);
    return CaseReader.valueOf(this.item, name);
  }

  // Compares an observed value with the expected field of the case. An absent optional field compares nothing. A
  // response field is compared by its name (HYR-11).
  compare(name: string, observed: unknown): void {
    const field = CaseReader.fieldOf(this.section_, this.sectionName, name);
    if (!CaseReader.appliesTo(field, this.runner)) return;
    const expected = CaseReader.valueOf(this.item, name);
    if (expected === undefined) {
      if (field.optional === true) return;
      throw new Error(`the case has no field ${name}`);
    }
    const kind = field.role === 'response' ? CaseReader.RESPONSE_COMPARE[name] : field.compare;
    if (kind === undefined) throw new Error(`${name} of ${this.sectionName} has no comparison`);
    this.compared.add(name);
    this.read.add(name);
    const ok = CaseReader.HEADER_FIELDS.has(name)
      ? this.matches(kind, CaseReader.folded(expected), CaseReader.folded(observed))
      : this.matches(kind, expected, observed);
    if (!ok) this.differs.push(name);
  }

  // Compares an outcome of the section. A `raises` outcome holds when the step raised the open error; any other outcome
  // is given as the pair of values that must be equal.
  outcome(name: string, observed: unknown): void {
    const declared = this.section_.outcomes?.[name];
    if (declared === undefined) throw new Error(`${this.sectionName} declares no outcome ${name}`);
    if (!CaseReader.appliesTo(declared, this.runner)) return;
    this.compared.add(name);
    const pair = observed as [unknown, unknown];
    const ok =
      declared.compare === 'raises'
        ? this.matches('raises', true, observed)
        : this.equal(pair[0], pair[1], false);
    if (!ok) this.differs.push(name);
  }

  // Marks the case as failed with a reason that the runner states as CASE_ERROR.
  fail(reason: string): void {
    this.error = `CASE_ERROR ${reason.replace(/\s+/g, ' ').trim()}`;
  }

  // Returns the result line of the case: its first failure in the order of HYR-7.
  line(): string {
    const head = `CASE ${this.file} ${this.id()}`;
    if (this.undeclared !== undefined) return `${head} FAIL FILE_UNDECLARED ${this.undeclared}`;
    if (this.error !== undefined) return `${head} FAIL ${this.error}`;
    if (this.compared.size === 0) return `${head} FAIL CASE_EMPTY`;
    if (this.differs.length > 0) return `${head} FAIL FIELD_DIFFERS ${this.differs[0]}`;
    const unknown = CaseReader.unreadIn(this.section_.fields, this.item, '', ['input'], this.read, this.runner);
    if (unknown !== undefined) return `${head} FAIL FIELD_UNKNOWN ${unknown}`;
    const uncompared = CaseReader.unreadIn(this.section_.fields, this.item, '', ['expected', 'response'], this.compared, this.runner);
    if (uncompared !== undefined) return `${head} FAIL FIELD_UNCOMPARED ${uncompared}`;
    const outcome = Object.entries(this.section_.outcomes ?? {}).find(([name, declared]) => CaseReader.appliesTo(declared, this.runner) && !this.compared.has(name));
    if (outcome !== undefined) return `${head} FAIL FIELD_UNCOMPARED ${outcome[0]}`;
    return `${head} PASS`;
  }

  private equal(a: unknown, b: unknown, ordered: boolean): boolean {
    if (Array.isArray(a) || Array.isArray(b)) {
      return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => this.equal(item, b[i], ordered));
    }
    const ea = CaseReader.entriesOf(a);
    const eb = CaseReader.entriesOf(b);
    if (ea !== undefined || eb !== undefined) {
      if (ea === undefined || eb === undefined || ea.length !== eb.length) return false;
      if (ordered) {
        return ea.every(([key, item], i) => {
          const other = eb[i];
          return other !== undefined && other[0] === key && this.equal(item, other[1], true);
        });
      }
      return ea.every(([key, item]) => eb.some(([name]) => name === key) && this.equal(item, CaseReader.member(b, key), false));
    }
    return a === b;
  }

  private matches(kind: Compare, expected: unknown, observed: unknown): boolean {
    // The contains and excludes comparisons take one text or a list of texts.
    const texts = typeof expected === 'string' ? [expected] : (expected as string[]);
    const names = expected as string[];
    const items = expected as unknown[];
    switch (kind) {
      case 'exact':
        return this.equal(expected, observed, false);
      case 'ordered':
        return this.equal(expected, observed, true);
      case 'subset':
        return (CaseReader.entriesOf(expected) ?? []).every(([name, value]) => CaseReader.member(observed, name) === value);
      case 'absent':
        return names.every((name) => CaseReader.member(observed, name) === undefined);
      case 'contains':
        return typeof observed === 'string' && texts.every((text) => observed.includes(text));
      case 'excludes':
        return typeof observed === 'string' && texts.every((text) => !observed.includes(text));
      case 'prefix':
        return Array.isArray(observed) && this.equal(expected, observed.slice(0, items.length), true);
      case 'keys':
        return this.equal(expected, (CaseReader.entriesOf(observed) ?? []).map(([key]) => key), true);
      case 'raises':
        return expected === CaseReader.isExactError(observed);
    }
  }

  // The case files of interfaces.json, read once; the declaration of each case file is its entry.
  private static declaration(): Record<string, Declaration> {
    CaseReader.cached ??= (JSON.parse(readFileSync(new URL('interfaces.json', CaseReader.CONTRACTS), 'utf8')) as { caseFiles: Record<string, Declaration> }).caseFiles;
    return CaseReader.cached;
  }

  private static appliesTo(declared: { only?: Only }, runner: string): boolean {
    return declared.only === undefined || declared.only.languages.includes(runner);
  }

  // Whether a value is an error of exactly the class Error (HY-106), not a subclass of it.
  private static isExactError(value: unknown): boolean {
    return typeof value === 'object' && value !== null && value.constructor === Error;
  }

  // The entries of an object of the contract, which is a Map that keeps the order of its keys, or undefined for a value
  // that is not an object.
  private static entriesOf(value: unknown): [string, unknown][] | undefined {
    if (value instanceof Map) return [...value.entries()].map(([key, item]) => [String(key), item]);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return Object.entries(value);
    return undefined;
  }

  // The member of an object of the contract under a key, or undefined when the object has no such key.
  private static member(value: unknown, key: string): unknown {
    return (CaseReader.entriesOf(value) ?? []).find(([name]) => name === key)?.[1];
  }

  // Lowers the ASCII capitals of a text and nothing else (HY-130).
  private static asciiLower(text: string): string {
    return text.replace(/[A-Z]+/g, (part) => part.toLowerCase());
  }

  // The header names of a value folded to ASCII lower case, as a map or as a list of names.
  private static folded(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => (typeof item === 'string' ? CaseReader.asciiLower(item) : item));
    const entries = CaseReader.entriesOf(value);
    if (entries === undefined) return value;
    return Object.fromEntries(entries.map(([key, item]) => [CaseReader.asciiLower(key), item]));
  }

  // The declared field at a dotted name of a section, which throws when the section does not declare it.
  private static fieldOf(section: Section, sectionName: string, name: string): Field {
    let fields: Record<string, Field> | undefined = section.fields;
    let field: Field | undefined;
    for (const part of name.split('.')) {
      field = fields !== undefined && Object.hasOwn(fields, part) ? fields[part] : undefined;
      if (field === undefined) throw new Error(`${sectionName} declares no field ${name}`);
      fields = field.fields;
    }
    return field as Field;
  }

  // The value of a dotted name in a case, or undefined when the case does not state it.
  private static valueOf(item: unknown, name: string): unknown {
    let value: unknown = item;
    for (const part of name.split('.')) {
      if (CaseReader.entriesOf(value) === undefined) return undefined;
      value = CaseReader.member(value, part);
    }
    return value;
  }

  // The first present field of the given roles, by dotted name, that the set of read or compared names does not cover.
  private static unreadIn(
    fields: Record<string, Field>,
    item: unknown,
    prefix: string,
    roles: string[],
    seen: Set<string>,
    runner: string,
  ): string | undefined {
    for (const [key, field] of Object.entries(fields)) {
      const child = CaseReader.member(item, key);
      if (!CaseReader.appliesTo(field, runner) || child === undefined) continue;
      const name = prefix + key;
      if (field.fields !== undefined && CaseReader.entriesOf(child) !== undefined) {
        const inner = CaseReader.unreadIn(field.fields, child, `${name}.`, roles, seen, runner);
        if (inner !== undefined) return inner;
        continue;
      }
      if (!roles.includes(field.role)) continue;
      if (![...seen].some((covered) => name === covered || name.startsWith(`${covered}.`))) return name;
    }
    return undefined;
  }

  // The first key of a case file, or of one of its cases, that the declaration does not state, as the path of the key.
  private static undeclaredIn(contract: unknown, declaration: Declaration, runner: string): string | undefined {
    for (const [key] of CaseReader.entriesOf(contract) ?? []) {
      if (CaseReader.SKIPPED_KEYS.has(key)) continue;
      if (!Object.hasOwn(declaration.sections, key) && !Object.hasOwn(declaration.fixtures, key)) return `$.${key}`;
    }
    for (const [name, section] of Object.entries(declaration.sections)) {
      const items = CaseReader.member(contract, name);
      if (!section.runners.includes(runner) || !Array.isArray(items)) continue;
      const declared = CaseReader.undeclaredDeclaration(section.fields, `$.${name}`, runner);
      if (declared !== undefined) return declared;
      for (const [index, item] of items.entries()) {
        const found = CaseReader.undeclaredFields(section.fields, item, `$.${name}[${index}]`);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  }

  // The first expected field without fields that has no comparison or no sentence, as its path in the declaration.
  private static undeclaredDeclaration(fields: Record<string, Field>, path: string, runner: string): string | undefined {
    for (const [key, field] of Object.entries(fields)) {
      if (!CaseReader.appliesTo(field, runner)) continue;
      if (field.fields !== undefined) {
        const found = CaseReader.undeclaredDeclaration(field.fields, `${path}.${key}`, runner);
        if (found !== undefined) return found;
      } else if (field.role === 'expected' && (field.compare === undefined || field.sentence === undefined)) {
        return `${path}.${key}`;
      }
    }
    return undefined;
  }

  // The first key of a case that the declared fields do not state, as its path in the case file.
  private static undeclaredFields(fields: Record<string, Field>, value: unknown, path: string): string | undefined {
    for (const [key, child] of CaseReader.entriesOf(value) ?? []) {
      if (CaseReader.SKIPPED_KEYS.has(key)) continue;
      const field = Object.hasOwn(fields, key) ? fields[key] : undefined;
      if (field === undefined) return `${path}.${key}`;
      if (field.fields !== undefined) {
        const found = CaseReader.undeclaredFields(field.fields, child, `${path}.${key}`);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  }
}
