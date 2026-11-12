// The reader of the case files of contracts/ (HYR-7, HYR-11). It reads contracts/interfaces.json for the declaration of
// each field and outcome, checks that the case file holds nothing that the declaration does not state, and gives a step
// the cases of its section with the inputs that it reads and the comparisons that it makes. The steps of the Node server
// and the browser and build runners read their cases through this reader; the reader has no test of its own.
import { readFileSync } from 'node:fs';
import { type Compare, caseFileUrl, caseFiles, entriesOf, field, folded, kind, lookup, member, parsed, statedMessage, type Declaration, type Section, uncovered, undeclared, visible } from './case-rules.ts';

// Returns an expected value that is a list of strings, and fails for any other value.
function stringsOf(expected: unknown): string[] {
  if (!Array.isArray(expected) || !expected.every((item): item is string => typeof item === 'string')) throw new Error('the expected value of the comparison is not a list of texts');
  return expected;
}

// Returns the texts of a contains or an excludes comparison, which takes one text or a list of texts.
function textsOf(expected: unknown): string[] {
  return typeof expected === 'string' ? [expected] : stringsOf(expected);
}

export class CaseReader {
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
      const contract = parsed(readFileSync(caseFileUrl(file), 'utf8'));
      const found = undeclared(declaration, contract, runner);
      for (const [name] of entriesOf(contract) ?? []) {
        const section = Object.hasOwn(declaration.sections, name) ? declaration.sections[name] : undefined;
        const items = member(contract, name);
        if (section === undefined || !section.runners.includes(runner) || !Array.isArray(items)) continue;
        for (const item of items) {
          // HYR-7: a case with `only` is given only to the runners of the languages that it names.
          const only = lookup(item, 'only.languages');
          if (Array.isArray(only) && !only.includes(runner)) continue;
          readers.push(new CaseReader(runner, file, name, item, section, contract, found));
        }
      }
    }
    return readers;
  }

  section(): string {
    return `${this.file}:${this.sectionName}`;
  }

  id(): string {
    return String(member(this.item, 'id'));
  }

  // Whether the case states a field, with dotted names for the fields of a nested field.
  has(name: string): boolean {
    return lookup(this.item, name) !== undefined;
  }

  // Returns the input of the case, or the fixture of the file that the section uses; the input is read for `line`.
  input(name: string): unknown {
    this.read.add(name);
    if (this.section_.uses.includes(name)) return member(this.contract, name);
    if (field(this.section_.fields, name, this.sectionName).role !== 'input') throw new Error(`${name} of ${this.sectionName} is not an input`);
    return lookup(this.item, name);
  }

  // Compares an observed value with the expected field of the case. An absent optional field compares nothing. A
  // response field is compared by its name (HYR-11).
  compare(name: string, observed: unknown): void {
    const declared = field(this.section_.fields, name, this.sectionName);
    if (!visible(declared, this.runner)) return;
    const expected = lookup(this.item, name);
    if (expected === undefined) {
      if (declared.optional === true) return;
      throw new Error(`the case has no field ${name}`);
    }
    const comparison = kind(declared, name, this.sectionName);
    this.compared.add(name);
    this.read.add(name);
    if (!this.matches(comparison, folded(name, expected), folded(name, statedMessage(name, expected, observed)))) this.differs.push(name);
  }

  // Compares an outcome of the section. A `raises` outcome holds when the step raised the open error; any other outcome
  // is given as the pair of values that must be equal.
  outcome(name: string, observed: unknown): void {
    const declared = this.section_.outcomes?.[name];
    if (declared === undefined) throw new Error(`${this.sectionName} declares no outcome ${name}`);
    if (!visible(declared, this.runner)) return;
    this.compared.add(name);
    if (declared.compare === 'raises') {
      if (!this.matches('raises', true, observed)) this.differs.push(name);
      return;
    }
    if (!Array.isArray(observed) || observed.length !== 2) throw new Error(`the outcome ${name} is not a pair of values`);
    const pair: unknown[] = observed;
    if (!this.equal(pair[0], pair[1], false)) this.differs.push(name);
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
    const unknown = uncovered(this.section_.fields, this.item, '', ['input'], this.read, this.runner);
    if (unknown !== undefined) return `${head} FAIL FIELD_UNKNOWN ${unknown}`;
    const uncompared = uncovered(this.section_.fields, this.item, '', ['expected', 'response'], this.compared, this.runner);
    if (uncompared !== undefined) return `${head} FAIL FIELD_UNCOMPARED ${uncompared}`;
    const outcome = Object.entries(this.section_.outcomes ?? {}).find(([name, declared]) => visible(declared, this.runner) && !this.compared.has(name));
    if (outcome !== undefined) return `${head} FAIL FIELD_UNCOMPARED ${outcome[0]}`;
    return `${head} PASS`;
  }

  // The case files of interfaces.json, read once; the declaration of each case file is its entry.
  private static declaration(): Record<string, Declaration> {
    return caseFiles();
  }

  private equal(a: unknown, b: unknown, ordered: boolean): boolean {
    if (Array.isArray(a) || Array.isArray(b)) {
      return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => this.equal(item, b[i], ordered));
    }
    const ea = entriesOf(a);
    const eb = entriesOf(b);
    if (ea !== undefined || eb !== undefined) {
      if (ea === undefined || eb === undefined || ea.length !== eb.length) return false;
      if (ordered) {
        return ea.every(([key, item], i) => {
          const other = eb[i];
          return other !== undefined && other[0] === key && this.equal(item, other[1], true);
        });
      }
      return ea.every(([key, item]) => eb.some(([name]) => name === key) && this.equal(item, member(b, key), false));
    }
    return a === b;
  }

  private matches(comparison: Compare, expected: unknown, observed: unknown): boolean {
    switch (comparison) {
      case 'exact':
        return this.equal(expected, observed, false);
      case 'ordered':
        return this.equal(expected, observed, true);
      case 'subset':
        // HYR-11: every key of the expected map is a key of the observed map with an equal value, as `exact` compares.
        return (entriesOf(expected) ?? []).every(([name, value]) => (entriesOf(observed) ?? []).some(([key]) => key === name) && this.equal(value, member(observed, name), false));
      case 'absent':
        return stringsOf(expected).every((name) => member(observed, name) === undefined);
      case 'contains':
        return typeof observed === 'string' && textsOf(expected).every((text) => observed.includes(text));
      case 'excludes':
        return typeof observed === 'string' && textsOf(expected).every((text) => !observed.includes(text));
      case 'prefix':
        if (!Array.isArray(expected)) throw new Error('the expected value of a prefix comparison is not a list');
        return Array.isArray(observed) && this.equal(expected, observed.slice(0, expected.length), true);
      case 'keys':
        return this.equal(expected, (entriesOf(observed) ?? []).map(([key]) => key), true);
      case 'raises':
        // Whether a value is an error of exactly the class Error (HY-106), not a subclass of it.
        return expected === (typeof observed === 'object' && observed !== null && observed.constructor === Error);
    }
  }
}
