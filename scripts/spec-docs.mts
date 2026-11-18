// The protocol documents (docs/spec/protocol.md and protocol.ko.md) rendered from contracts/protocol.json (plan H2).
// Both modes first validate the model against scripts/schema/protocol.schema.json and the semantic rules: statement ids
// and their numbering, koSource, one sentence (HYR-6) per English statement, and the marks of the statements that no
// code follows (`unimplemented`, H35.40), which are compared with the checklist and the feature status of the root.
// `write` renders the documents; `check`
// also fails when a committed document differs from its rendering. `released` compares the ids of the contract with
// those of the last release (H35.98). Usage: spec-docs.mts write|check|released [--root <dir>]
import { Ajv2020 } from 'ajv/dist/2020.js';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sentences } from './recipe/rules.mts';
import { isSchema } from './recipe/validators.mts';

type Lang = 'en' | 'ko';
type Text = { en: string; ko: string };
type Server = 'php' | 'node' | 'python';
// A mark is the row of every server, or the rows of the servers that do not meet the statement (H35.40-2).
type Mark = string | { row: string; servers: Server[] }[];
type Statement = Text & { id?: string; koSource: string; term?: string; unimplemented?: Mark };
type Item = { statements: Statement[]; blocks: Block[] };
type Block =
  | { kind: 'paragraph'; statements: Statement[] }
  | { kind: 'list'; ordered: boolean; items: Item[] }
  | { kind: 'code'; language: string; text: string }
  | { kind: 'table'; header: Text[]; rows: Text[][] }
  | { kind: 'rule'; id: string; retired: number[]; blocks: Block[] };
type Contract = {
  docId: string;
  title: Text;
  intro: Block[];
  sections: { title: Text; blocks: Block[] }[];
  retiredRules: string[];
};
type Rule = { id: string; used: Set<number> };

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const GENERATED: Record<Lang, string> = {
  en: '<!-- Generated from contracts/protocol.json; DO NOT EDIT. -->',
  ko: '<!-- contracts/protocol.json에서 생성됨. 직접 수정하지 않는다. -->',
};

// The mark of a statement that no code follows (H35.40): the statement holds `unimplemented`, the id of the row of the
// checklist that implements it, and each document shows this phrase with the row after the statement.
const UNIMPLEMENTED: Record<Lang, (row: string) => string> = {
  en: (row) => ` *(Not implemented: row ${row}.)*`,
  ko: (row) => ` *(구현되지 않음: 행 ${row}.)*`,
};
// The names of the servers in a mark per server, and the phrase of each language with the servers before each row.
const SERVER_NAMES: Record<Server, string> = { php: 'PHP', node: 'Node', python: 'Python' };
// The Korean topic particle after the last name: `Python` ends in a consonant sound, `PHP` and `Node` in a vowel sound.
const TOPIC_KO: Record<Server, string> = { php: '는', node: '는', python: '은' };
const joined = (names: string[], and: string): string => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')}${and}${names.at(-1) ?? ''}`);
const UNIMPLEMENTED_PER_SERVER: Record<Lang, (marks: { row: string; servers: Server[] }[]) => string> = {
  en: (marks) => ` *(Not implemented ${marks.map((m) => `in ${joined(m.servers.map((s) => SERVER_NAMES[s]), ' and ')}: row ${m.row}`).join('; ')}.)*`,
  ko: (marks) => ` *(구현되지 않음: ${marks.map((m) => `${joined(m.servers.map((s) => SERVER_NAMES[s]), '와 ')}${TOPIC_KO[m.servers.at(-1) ?? 'php']} 행 ${m.row}`).join(', ')}.)*`,
};

/** The phrase of a mark in a language. */
function markPhrase(mark: Mark, lang: Lang): string {
  return typeof mark === 'string' ? UNIMPLEMENTED[lang](mark) : UNIMPLEMENTED_PER_SERVER[lang](mark);
}

/** The rows of a mark. */
function markRows(mark: Mark): string[] {
  return typeof mark === 'string' ? [mark] : mark.map((m) => m.row);
}
const CHECKLIST = 'docs/plans/execution/checklist.md';
const FEATURES = 'docs/features.md';
// The states of a row of the checklist whose task is done: a mark that names such a row is removed with the task.
const DONE = ['[o]', '[v]'];
const NOT_IMPLEMENTED = 'not implemented';
const STATEMENT_ID = /HYC?-[1-9][0-9]*\.[1-9][0-9]*/gu;

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** The statements of the contract that hold an id, in document order. */
function statementsOf(contract: Contract): Statement[] {
  const found: Statement[] = [];
  const blocks = (list: Block[]): void => {
    for (const block of list) {
      if (block.kind === 'paragraph') found.push(...block.statements);
      else if (block.kind === 'rule') blocks(block.blocks);
      else if (block.kind === 'list') {
        for (const item of block.items) {
          found.push(...item.statements);
          blocks(item.blocks);
        }
      }
    }
  };
  blocks(contract.intro);
  for (const section of contract.sections) blocks(section.blocks);
  return found;
}

/** The cells of the rows of the first table of a document whose header row holds `header`, without the header rows. */
function tableRows(text: string, header: string): string[][] {
  const rows: string[][] = [];
  let inside = false;
  for (const line of text.split('\n')) {
    if (!inside) {
      inside = line === header;
      continue;
    }
    if (!line.startsWith('|')) break;
    if (/^\|[-| ]+\|$/u.test(line)) continue;
    rows.push(line.slice(1, line.lastIndexOf('|')).split(' | ').map((cell) => cell.trim()));
  }
  return rows;
}

/**
 * The rules of the marks (H35.40). The contract is the source of the fact that no code follows a statement: the row of
 * a mark is an open row of the checklist, and the rows of the feature status with the status `not implemented` name
 * exactly the marked statements, each statement by its id in the cell Feature. A tree without marks and without a
 * feature status, such as the fixture of the tests, has nothing to compare.
 */
function markProblems(contract: Contract, root: string): string[] {
  const problems: string[] = [];
  const all = statementsOf(contract);
  const marks = new Map<string, string[]>();
  for (const s of all) {
    if (s.unimplemented === undefined) continue;
    if (s.id === undefined) problems.push(`"${s.en}" holds a mark and no id; only a statement with an id is marked`);
    else {
      marks.set(s.id, markRows(s.unimplemented));
      if (typeof s.unimplemented !== 'string') {
        const seen = new Set<Server>();
        for (const server of s.unimplemented.flatMap((m) => m.servers)) {
          if (seen.has(server)) problems.push(`${s.id}: its mark names the server ${server} twice`);
          seen.add(server);
        }
      }
    }
  }
  const read = (name: string): string | undefined => (existsSync(path.join(root, name)) ? readFileSync(path.join(root, name), 'utf8') : undefined);

  const checklist = read(CHECKLIST);
  if (marks.size > 0 && checklist === undefined) problems.push(`${CHECKLIST} is missing, and the contract holds marks that name its rows`);
  if (checklist !== undefined) {
    const states = new Map<string, string>();
    for (const line of checklist.split('\n')) {
      const row = /^\| (H[0-9][^ |]*) \|.*\| (\[.\])[^|]*\|$/u.exec(line);
      if (row?.[1] !== undefined && row[2] !== undefined) states.set(row[1], row[2]);
    }
    for (const [id, rows] of marks) {
      for (const row of rows) {
        const state = states.get(row);
        if (state === undefined) problems.push(`${id}: the row ${row} of its mark is no row of ${CHECKLIST}`);
        else if (DONE.includes(state)) problems.push(`${id}: the row ${row} of its mark has the state ${state}; remove the mark`);
      }
    }
  }

  const features = read(FEATURES);
  if (marks.size > 0 && features === undefined) problems.push(`${FEATURES} is missing, and the contract holds marks that its rows name`);
  if (features !== undefined) {
    const named = new Set<string>();
    for (const [row, feature, status] of tableRows(features, '| ID | Feature | Status | Evidence |')) {
      if (row === undefined || feature === undefined || status?.startsWith(NOT_IMPLEMENTED) !== true) continue;
      for (const id of feature.match(STATEMENT_ID) ?? []) {
        named.add(id);
        if (!marks.has(id)) problems.push(`${FEATURES}: the row ${row} names ${id} as not implemented, and the statement holds no mark`);
      }
    }
    for (const id of marks.keys()) {
      if (!named.has(id)) problems.push(`${id} holds a mark, and no row of ${FEATURES} with the status ${NOT_IMPLEMENTED} names it`);
    }
  }
  return problems;
}

/** The semantic rules the schema cannot state: statement ids and their numbering, koSource, one English sentence. */
function semanticProblems(contract: Contract): string[] {
  const problems: string[] = [];
  const ruleIds = new Set<string>();
  const statementIds = new Set<string>();

  const statements = (list: Statement[], rule: Rule | undefined): void => {
    for (const s of list) {
      const label = s.id ?? `"${s.en}"`;
      if (rule) {
        if (s.id === undefined) {
          problems.push(`${label}: a statement of rule ${rule.id} needs an id`);
        } else {
          const match = /^(.*)\.([0-9]+)$/.exec(s.id);
          if (match?.[1] !== rule.id) problems.push(`statement id ${s.id} is not in rule ${rule.id}`);
          else rule.used.add(Number(match[2]));
        }
      } else if (s.id !== undefined) {
        problems.push(`statement id ${s.id} is outside a rule`);
      }
      if (s.id !== undefined) {
        if (statementIds.has(s.id)) problems.push(`duplicate statement id ${s.id}`);
        statementIds.add(s.id);
      }
      const sha = sha256(s.en);
      if (s.koSource !== sha) problems.push(`${label}: koSource is stale; the sha256 of its en is ${sha}`);
      const count = sentences(s.en).length;
      if (count !== 1) problems.push(`${label} is ${count} sentences by HYR-6; a statement is one sentence`);
    }
  };

  const blocks = (list: Block[], rule: Rule | undefined): void => {
    for (const block of list) {
      switch (block.kind) {
        case 'paragraph':
          statements(block.statements, rule);
          break;
        case 'list':
          for (const item of block.items) {
            statements(item.statements, rule);
            blocks(item.blocks, rule);
          }
          break;
        case 'code':
          break;
        case 'table':
          for (const row of block.rows) {
            if (row.length !== block.header.length) {
              problems.push(`table row has ${row.length} cells; its header has ${block.header.length}`);
            }
          }
          break;
        case 'rule': {
          if (block.blocks[0]?.kind !== 'paragraph') problems.push(`rule ${block.id} must begin with a paragraph`);
          if (ruleIds.has(block.id)) problems.push(`duplicate rule id ${block.id}`);
          ruleIds.add(block.id);
          const own: Rule = { id: block.id, used: new Set() };
          blocks(block.blocks, own);
          numbering(own, block.retired);
          break;
        }
      }
    }
  };

  const numbering = (rule: Rule, retired: number[]): void => {
    for (const n of retired) {
      if (rule.used.has(n)) problems.push(`statement id ${rule.id}.${n} is used and retired`);
    }
    const taken = new Set([...rule.used, ...retired]);
    const max = Math.max(0, ...taken);
    for (let n = 1; n <= max; n++) {
      if (!taken.has(n)) problems.push(`numbering gap in ${rule.id}: ${n} is neither used nor retired`);
    }
  };

  blocks(contract.intro, undefined);
  for (const section of contract.sections) blocks(section.blocks, undefined);
  for (const id of contract.retiredRules) {
    if (ruleIds.has(id)) problems.push(`${id} is a rule and in retiredRules`);
  }
  return problems;
}

function inline(list: Statement[], lang: Lang): string {
  return list.map((s) => (s.id === undefined ? '' : `<a id="${s.id}"></a> `) + s[lang] + (s.unimplemented === undefined ? '' : markPhrase(s.unimplemented, lang))).join(' ');
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => (line === '' ? line : `  ${line}`))
    .join('\n');
}

function renderBlock(block: Block, lang: Lang): string {
  switch (block.kind) {
    case 'paragraph':
      return inline(block.statements, lang);
    case 'code':
      return ['```' + block.language, block.text, '```'].join('\n');
    case 'table': {
      const row = (cells: Text[]): string => `| ${cells.map((c) => c[lang]).join(' | ')} |`;
      const rule = `| ${block.header.map(() => '---').join(' | ')} |`;
      return [row(block.header), rule, ...block.rows.map(row)].join('\n');
    }
    case 'list':
      return block.items
        .map((item, i) => {
          let text = (block.ordered ? `${i + 1}. ` : '- ') + inline(item.statements, lang);
          for (const nested of item.blocks) text += '\n\n' + indent(renderBlock(nested, lang));
          return text;
        })
        .join('\n');
    case 'rule': {
      const [head, ...rest] = block.blocks;
      let text = `- **${block.id}** ` + (head?.kind === 'paragraph' ? inline(head.statements, lang) : '');
      for (const nested of rest) text += '\n\n' + indent(renderBlock(nested, lang));
      return text;
    }
  }
}

/** One document: the title, the header comment, the intro, then each section as `## title` and its blocks. */
function render(contract: Contract, lang: Lang, englishSha?: string): string {
  const head = [`<!-- doc-id: ${contract.docId} -->`];
  if (englishSha !== undefined) head.push(`<!-- source-sha256: ${englishSha} -->`);
  head.push(`# ${contract.title[lang]}`);
  const chunks = [head.join('\n'), GENERATED[lang], ...contract.intro.map((b) => renderBlock(b, lang))];
  for (const section of contract.sections) {
    chunks.push(`## ${section.title[lang]}`, ...section.blocks.map((b) => renderBlock(b, lang)));
  }
  return chunks.join('\n\n') + '\n';
}

function firstDifferentLine(actual: string, expected: string): number {
  const a = actual.split('\n');
  const e = expected.split('\n');
  for (let i = 0; i < Math.max(a.length, e.length); i++) {
    if (a[i] !== e[i]) return i + 1;
  }
  return 1;
}

// The check of the released ids (H35.98): the statements of the release that config/spec-baseline.json names, read from
// its tag, are compared with the contract of the tree. An id keeps one meaning, so a released id is either a statement
// of the same topic or retired. The topic changed when the section title (en) or the rule of the statement changed, or
// when the word sets of the two English texts share less than TOPIC_SHARE (Jaccard); a citation and a code span count
// as one word each, so that a renumbered citation or a renamed symbol is a wording edit.
const BASELINE = 'config/spec-baseline.json';
const TOPIC_SHARE = 0.4;
const VERSION_HEADING = /^## ([0-9]+\.[0-9]+\.[0-9]+)\s*$/gmu;

type Placed = { id: string; rule: string; section: string; en: string };

/**
 * Whether a model holds the lists that the comparison reads. A released contract passed the schema of its own release,
 * which this schema may no longer accept, so the comparison checks only the shape it walks; spec-docs-check validates
 * the contract of the tree.
 */
function holdsSections(model: unknown): model is Contract {
  return typeof model === 'object' && model !== null && 'sections' in model && Array.isArray(model.sections) && 'retiredRules' in model && Array.isArray(model.retiredRules);
}

/** The statements of a contract that hold an id, each with its rule and the English title of its section. */
function placedStatements(contract: Contract): Placed[] {
  const found: Placed[] = [];
  const walk = (list: Block[], section: string, rule: string | undefined): void => {
    for (const block of list) {
      if (block.kind === 'rule') walk(block.blocks, section, block.id);
      else if (block.kind === 'paragraph' || block.kind === 'list') {
        const groups = block.kind === 'paragraph' ? [{ statements: block.statements, blocks: [] }] : block.items;
        for (const group of groups) {
          for (const s of group.statements) if (s.id !== undefined && rule !== undefined) found.push({ id: s.id, rule, section, en: s.en });
          walk(group.blocks, section, rule);
        }
      }
    }
  };
  for (const section of contract.sections) walk(section.blocks, section.title.en, undefined);
  return found;
}

/** The retired ids of a contract: each retired number of a rule, and each rule of retiredRules. */
function retiredOf(contract: Contract): { statements: Set<string>; rules: Set<string> } {
  const statements = new Set<string>();
  const walk = (list: Block[]): void => {
    for (const block of list) {
      if (block.kind === 'rule') {
        for (const n of block.retired) statements.add(`${block.id}.${n}`);
        walk(block.blocks);
      } else if (block.kind === 'list') for (const item of block.items) walk(item.blocks);
    }
  };
  for (const section of contract.sections) walk(section.blocks);
  return { statements, rules: new Set(contract.retiredRules) };
}

/** The words of an English text, with each citation and each code span as one word. */
function topicWords(text: string): Set<string> {
  const reduced = text.replace(/HYC?-[0-9]+(?:\.[0-9]+)?/gu, ' cite ').replace(/`[^`]*`/gu, ' code ');
  return new Set(reduced.toLowerCase().match(/[a-z0-9]+/gu) ?? []);
}

function share(a: Set<string>, b: Set<string>): number {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 1;
  let common = 0;
  for (const word of a) if (b.has(word)) common += 1;
  return common / union.size;
}

function git(root: string, args: string[]): { ok: boolean; out: string; err: string } {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return { ok: result.status === 0, out: result.stdout, err: result.stderr };
}

/** The problems of the released ids, with the lines that name the moved texts; the count of compared ids on success. */
function releasedProblems(root: string): { problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  const baselineFile = path.join(root, BASELINE);
  if (!existsSync(baselineFile)) return { problems: [`${BASELINE} is missing; it names the version of the last release`], notes };
  const baseline: unknown = JSON.parse(readFileSync(baselineFile, 'utf8'));
  const version = typeof baseline === 'object' && baseline !== null && 'version' in baseline && typeof baseline.version === 'string' ? baseline.version : undefined;
  if (version === undefined || !/^[0-9]+\.[0-9]+\.[0-9]+$/u.test(version)) return { problems: [`${BASELINE} holds no version X.Y.Z`], notes };
  const tag = `v${version}`;
  const hasTag = (name: string): boolean => git(root, ['rev-parse', '-q', '--verify', `refs/tags/${name}`]).ok;
  if (!hasTag(tag)) return { problems: [`the tag ${tag} of ${BASELINE} is missing; fetch the tags of the repository (git fetch --tags)`], notes };

  // The baseline is the newest version of the change log that has a tag: at a version-bump commit the new section has
  // no tag yet, and after a release a baseline that names an older version is stale.
  const changelogFile = path.join(root, 'CHANGELOG.md');
  if (!existsSync(changelogFile)) problems.push('CHANGELOG.md is missing; the baseline is compared with its versions');
  else {
    const versions = [...readFileSync(changelogFile, 'utf8').matchAll(VERSION_HEADING)].map((m) => m[1] ?? '');
    const newest = versions.find((v) => hasTag(`v${v}`));
    if (newest === undefined) problems.push(`no version of CHANGELOG.md has a tag; ${BASELINE} names ${version}`);
    else if (newest !== version) problems.push(`${BASELINE} names ${version}; the newest version of CHANGELOG.md with a tag is ${newest}`);
  }

  const shown = git(root, ['show', `${tag}:contracts/protocol.json`]);
  if (!shown.ok) return { problems: [...problems, `git show ${tag}:contracts/protocol.json failed: ${shown.err.trim()}`], notes };
  const releasedModel: unknown = JSON.parse(shown.out);
  const currentModel: unknown = JSON.parse(readFileSync(path.join(root, 'contracts', 'protocol.json'), 'utf8'));
  if (!holdsSections(releasedModel)) return { problems: [...problems, `contracts/protocol.json of ${tag} holds no sections and retiredRules`], notes };
  if (!holdsSections(currentModel)) return { problems: [...problems, 'contracts/protocol.json holds no sections and retiredRules'], notes };
  const released = placedStatements(releasedModel);
  const current = currentModel;
  const now = new Map(placedStatements(current).map((s) => [s.id, s]));
  const byText = new Map(placedStatements(current).map((s) => [s.en, s.id]));
  const retired = retiredOf(current);
  for (const old of released) {
    const moved = byText.get(old.en);
    if (moved !== undefined && moved !== old.id) notes.push(`the text of ${old.id} of ${tag} is now ${moved}`);
    const s = now.get(old.id);
    if (s === undefined) {
      if (!retired.statements.has(old.id) && !retired.rules.has(old.rule)) problems.push(`${old.id} of ${tag} is missing and not retired`);
      continue;
    }
    const changes: string[] = [];
    if (s.section !== old.section) changes.push(`section ${old.section} -> ${s.section}`);
    if (s.rule !== old.rule) changes.push(`rule ${old.rule} -> ${s.rule}`);
    const common = share(topicWords(old.en), topicWords(s.en));
    if (common < TOPIC_SHARE) changes.push(`its words share ${common.toFixed(2)}, below ${TOPIC_SHARE}`);
    if (changes.length > 0) problems.push(`${old.id} of ${tag} changed its topic: ${changes.join('; ')}; retire the id and add a new statement`);
  }
  notes.push(`compared ${released.length} released statement ids of ${tag}`);
  return { problems, notes };
}

function usage(): number {
  process.stderr.write('usage: spec-docs.mts write|check|released [--root <dir>]\n');
  return 2;
}

function main(argv: string[]): number {
  const [mode, ...rest] = argv;
  if (mode !== 'write' && mode !== 'check' && mode !== 'released') return usage();
  let root = repo;
  if (rest.length > 0) {
    if (rest.length !== 2 || rest[0] !== '--root' || rest[1] === undefined) return usage();
    root = path.resolve(rest[1]);
  }
  if (mode === 'released') {
    const { problems, notes } = releasedProblems(root);
    for (const note of notes) process.stdout.write(`${note}\n`);
    for (const problem of problems) process.stderr.write(`${problem}\n`);
    return problems.length > 0 ? 1 : 0;
  }

  const problems: string[] = [];
  const contractPath = path.join(root, 'contracts', 'protocol.json');
  let model: unknown;
  try {
    model = JSON.parse(readFileSync(contractPath, 'utf8'));
  } catch (error) {
    problems.push(`contracts/protocol.json: ${error instanceof Error ? error.message : String(error)}`);
  }

  // The contract is the model that passed the schema.
  let contract: Contract | undefined;
  if (model !== undefined) {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    const schema: unknown = JSON.parse(readFileSync(path.join(here, 'schema', 'protocol.schema.json'), 'utf8'));
    if (!isSchema(schema)) throw new Error('scripts/schema/protocol.schema.json is no JSON object');
    const validate = ajv.compile<Contract>(schema);
    if (validate(model)) {
      contract = model;
      problems.push(...semanticProblems(model), ...markProblems(model, root));
    } else {
      for (const error of validate.errors ?? []) {
        problems.push(`contracts/protocol.json${error.instancePath}: ${error.message}`);
      }
    }
  }

  if (problems.length > 0 || contract === undefined) {
    for (const problem of problems) process.stderr.write(`${problem}\n`);
    return 1;
  }

  const english = render(contract, 'en');
  const korean = render(contract, 'ko', sha256(english));
  const outputs: [string, string][] = [
    [`${contract.docId}.md`, english],
    [`${contract.docId}.ko.md`, korean],
  ];
  const specDir = path.join(root, 'docs', 'spec');

  if (mode === 'write') {
    mkdirSync(specDir, { recursive: true });
    for (const [name, text] of outputs) writeFileSync(path.join(specDir, name), text);
    return 0;
  }

  for (const [name, expected] of outputs) {
    const rel = `docs/spec/${name}`;
    const file = path.join(specDir, name);
    if (!existsSync(file)) {
      problems.push(`${rel} is missing; run make spec-docs`);
      continue;
    }
    const actual = readFileSync(file, 'utf8');
    if (actual !== expected) problems.push(`${rel} differs from its generation at line ${firstDifferentLine(actual, expected)}`);
  }
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  return problems.length > 0 ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
